#!/usr/bin/env python3
"""
One-time importer: parse Utopia IS screenshots and save to Firebase.

Screenshot filename = real identity name, e.g.:
  screenshots/
    a112/
      The Iron Fist.webp
      Crimson Dawn.webp
    a113/
      The Iron Fist.webp   ← same identity, different age

The script will:
  - Extract KD data from each screenshot via Claude vision
  - Create the identity (if new) or update it (if already seen)
  - Save the snapshot and confirm the match in one step

Usage:
  python import_screenshots.py              (looks for ./screenshots/)
  python import_screenshots.py my_folder/

Requirements:
  pip install anthropic requests

Environment:
  ANTHROPIC_API_KEY=sk-ant-...
"""

import os
import sys
import json
import base64
import time
import requests
import anthropic

# ── Firebase config (same as Wave Planner) ────────────────────────────────────
FB_PROJECT = 'utopia-leaderboard'
FB_API_KEY = 'AIzaSyAnlkMabj-9a-fUEx66o86w2CnJaUgboIY'
FB_BASE    = f'https://firestore.googleapis.com/v1/projects/{FB_PROJECT}/databases/(default)/documents'

# ── Firestore helpers ─────────────────────────────────────────────────────────

def to_fb(v):
    if v is None:           return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int):  return {'integerValue': str(v)}
    if isinstance(v, float):return {'doubleValue': v}
    if isinstance(v, str):  return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [to_fb(i) for i in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: to_fb(val) for k, val in v.items()}}}
    return {'stringValue': str(v)}

def from_fb(v):
    if not v: return None
    if 'stringValue'  in v: return v['stringValue']
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue'  in v: return v['doubleValue']
    if 'booleanValue' in v: return v['booleanValue']
    if 'nullValue'    in v: return None
    if 'arrayValue'   in v: return [from_fb(i) for i in v['arrayValue'].get('values', [])]
    if 'mapValue'     in v: return {k: from_fb(val) for k, val in v['mapValue'].get('fields', {}).items()}
    return None

def fb_write(path, data):
    fields = {k: to_fb(v) for k, v in data.items()}
    r = requests.patch(f'{FB_BASE}/{path}?key={FB_API_KEY}', json={'fields': fields}, timeout=10)
    r.raise_for_status()

def fb_query(collection):
    url  = f'{FB_BASE}:runQuery?key={FB_API_KEY}'
    body = {'structuredQuery': {'from': [{'collectionId': collection}], 'limit': 2000}}
    r    = requests.post(url, json=body, timeout=10)
    r.raise_for_status()
    docs = []
    for entry in r.json():
        if 'document' not in entry:
            continue
        docs.append({k: from_fb(v) for k, v in entry['document']['fields'].items()})
    return docs

# ── Claude vision extraction ──────────────────────────────────────────────────

PROMPT = """
This is a screenshot from the Utopia game's Intel Site showing an enemy kingdom's Overview tab.

Extract the following and return ONLY valid JSON, no markdown fences:
{
  "kdName": "kingdom name shown at the top",
  "location": "X:Y from the Enemy input field (e.g. 1:11)",
  "provinces": [
    {
      "slot": <integer from the # column>,
      "name": "<province name>",
      "ruler": "<ruler name>",
      "race": "<race>",
      "personality": "<personality>"
    }
  ]
}

Include every visible province row. If a field is not visible use null.
"""

IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}

def extract(client, image_path):
    ext        = os.path.splitext(image_path)[1].lower()
    media_type = IMAGE_TYPES.get(ext, 'image/png')
    with open(image_path, 'rb') as f:
        data = base64.standard_b64encode(f.read()).decode('utf-8')

    resp = client.messages.create(
        model='claude-sonnet-4-6',
        max_tokens=1024,
        messages=[{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': media_type, 'data': data}},
            {'type': 'text',  'text': PROMPT},
        ]}],
    )
    text = resp.content[0].text.strip()
    if text.startswith('```'):
        text = '\n'.join(text.split('\n')[1:]).rstrip('`').strip()
    return json.loads(text)

# ── Identity helpers ──────────────────────────────────────────────────────────

def new_id():
    return f"{int(time.time() * 1000):x}{os.urandom(2).hex()}"

def find_or_create_identity(identities, label):
    label_lower = label.lower()
    for identity in identities:
        if (identity.get('label') or '').lower() == label_lower:
            return identity
    # Create new
    identity = {
        'id':                  new_id(),
        'label':               label,
        'notes':               '',
        'kdHistory':           [],
        'rulersSeen':          [],
        'raceCounts':          {},
        'typicalProvinceCount': 0,
    }
    identities.append(identity)
    return identity

def update_identity(identity, provinces, age, location, kd_name):
    ruler_set = set(identity.get('rulersSeen') or [])
    for p in provinces:
        if p.get('ruler'):
            ruler_set.add(p['ruler'])

    race_counts = dict(identity.get('raceCounts') or {})
    for p in provinces:
        if p.get('race'):
            race_counts[p['race']] = race_counts.get(p['race'], 0) + 1

    kd_history = list(identity.get('kdHistory') or [])
    if not any(h.get('age') == age and h.get('location') == location for h in kd_history):
        kd_history.append({'age': age, 'location': location, 'kdName': kd_name or ''})

    prev_count = identity.get('typicalProvinceCount') or 0
    new_count  = round((prev_count + len(provinces)) / 2) if prev_count else len(provinces)

    identity.update({
        'rulersSeen':           sorted(ruler_set),
        'raceCounts':           race_counts,
        'kdHistory':            kd_history,
        'typicalProvinceCount': new_count,
    })

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    folder  = sys.argv[1] if len(sys.argv) > 1 else 'screenshots'
    api_key = os.environ.get('ANTHROPIC_API_KEY')

    if not api_key:
        sys.exit('Error: set ANTHROPIC_API_KEY environment variable')
    if not os.path.isdir(folder):
        sys.exit(f"Error: folder '{folder}' not found")

    client = anthropic.Anthropic(api_key=api_key)

    age_folders = sorted([
        d for d in os.listdir(folder)
        if os.path.isdir(os.path.join(folder, d))
        and d.startswith('a') and d[1:].isdigit()
    ])
    if not age_folders:
        sys.exit(f"No age folders in '{folder}' — expected names like a112, a113 ...")

    print(f"Found ages: {', '.join(age_folders)}")
    print("Loading existing identities from Firebase...")
    identities = fb_query('kd_identities')
    print(f"  {len(identities)} existing identit{'ies' if len(identities) != 1 else 'y'} loaded")

    saved = skipped = errors = 0

    for age in age_folders:
        age_path = os.path.join(folder, age)
        images   = sorted([
            f for f in os.listdir(age_path)
            if os.path.splitext(f)[1].lower() in IMAGE_TYPES
        ])
        if not images:
            print(f"\nAge {age}: no images, skipping")
            continue

        print(f"\n{'=' * 58}")
        print(f"  AGE {age}  —  {len(images)} screenshot{'s' if len(images) != 1 else ''}")

        for filename in images:
            # Filename without extension = real identity label
            label = os.path.splitext(filename)[0]
            path  = os.path.join(age_path, filename)

            print(f"\n  [{label}]  processing {filename}...")

            try:
                data = extract(client, path)
            except Exception as e:
                print(f"    ✗ Extraction failed: {e}")
                errors += 1
                continue

            loc      = data.get('location') or ''
            kd_name  = data.get('kdName')   or loc
            provinces = [
                {
                    'slot':        int(p.get('slot') or 0),
                    'name':        str(p.get('name')        or ''),
                    'ruler':       str(p.get('ruler')       or ''),
                    'race':        str(p.get('race')        or ''),
                    'personality': str(p.get('personality') or ''),
                    'land':        0,
                }
                for p in (data.get('provinces') or [])
            ]

            # Show summary
            print(f"    KD name:  {kd_name}")
            print(f"    Location: {loc or '?'}")
            print(f"    Rulers:   {', '.join(p['ruler'] for p in provinces if p['ruler'])}")

            if not loc:
                print("    ✗ No location found — skipping")
                skipped += 1
                continue

            # Ask for confirmation (showing extracted location in case it's wrong)
            ans = input(f"    Save as identity '{label}'? [y/n/loc] (loc to fix location) > ").strip().lower()
            if ans == 'loc':
                loc = input(f"    Enter correct location: ").strip()
                ans = 'y'
            if ans not in ('y', 'yes', ''):
                print("    — skipped")
                skipped += 1
                continue

            snap_key = f"{age}_{loc.replace(':', '-')}"
            identity = find_or_create_identity(identities, label)
            update_identity(identity, provinces, age, loc, kd_name)

            try:
                # Save snapshot (already confirmed — set identityId)
                fb_write(f'kd_snapshots/{snap_key}', {
                    'age':        age,
                    'location':   loc,
                    'kdName':     kd_name,
                    'savedAt':    '',
                    'identityId': identity['id'],
                    'provinces':  provinces,
                })
                # Save identity
                fb_write(f'kd_identities/{identity["id"]}', identity)

                rulers_found = len([p for p in provinces if p['ruler']])
                print(f"    ✓ Saved  snapshot: {snap_key}  |  identity: '{label}'  |  {rulers_found} rulers indexed")
                saved += 1
            except Exception as e:
                print(f"    ✗ Firebase write failed: {e}")
                errors += 1

    print(f"\n{'=' * 58}")
    print(f"  Done.  Saved: {saved}   Skipped: {skipped}   Errors: {errors}")
    if saved:
        print(f"\n  Open the KD DATABASE tab in the Wave Planner to see the imported data.")

if __name__ == '__main__':
    main()
