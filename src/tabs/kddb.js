// ── TAB: KINGDOM DATABASE ─────────────────────────────────────────────────────
// Enemy kingdom fingerprinting and identity tracking across ages.
// Stores snapshots in Firebase kd_snapshots collection.
// Identities tracked in kd_identities collection.
// Ruler names are the primary fingerprint signal across ages.

// ── Module-level state ────────────────────────────────────────────────────────
let _kddbIdentities = [];   // all known identities loaded from Firebase
let _kddbMatches    = [];   // match results for current snapshot
let _kddbSnapId     = null; // doc ID of last saved snapshot
let _kddbLoaded     = false;
let _kddbView       = 'main'; // 'main' | 'tag'
let _kddbTagData    = [];   // untagged snapshots for end-of-age tagging
let _kddbSearch     = '';

// ── Age helpers ───────────────────────────────────────────────────────────────

function _kddbGetAge() {
  return S.kddbAge || localStorage.getItem('wp_kddb_age') || '';
}

function _kddbSetAge(age) {
  const clean = age.trim().toLowerCase();
  S.kddbAge = clean;
  localStorage.setItem('wp_kddb_age', clean);
  renderKddb();
}

// ── ID helpers ────────────────────────────────────────────────────────────────

function _kddbNewId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _kddbSnapKey(age, location) {
  return `${age}_${location.replace(':', '-')}`;
}

// ── Firebase ──────────────────────────────────────────────────────────────────

async function _kddbLoadAll() {
  const docs = await fbQuery('kd_identities');
  _kddbIdentities = docs;
  _kddbLoaded = true;
}

async function _kddbSaveSnapshot() {
  const age = _kddbGetAge();
  if (!age)      { alert('Enter the current age first (e.g. a114)'); return; }
  if (!S.enemy)  { alert('No enemy kingdom loaded'); return; }

  const loc     = S.eLoc;
  const snapKey = _kddbSnapKey(age, loc);
  const provinces = (S.enemy.provinces || []).map(p => ({
    slot:        p.slot,
    name:        p.name || '',
    ruler:       p.sot?.ruler || '',
    race:        p.race || '',
    personality: p.sot?.personality || '',
    land:        p.land || 0,
  }));

  $id('__wpc_kddb').innerHTML = loadingHTML('SAVING SNAPSHOT...');
  await fbWrite(`kd_snapshots/${snapKey}`, {
    age,
    location:   loc,
    kdName:     S.enemy.kingdomName || loc,
    savedAt:    new Date().toISOString(),
    identityId: '',
    provinces,
  });

  _kddbSnapId  = snapKey;
  _kddbMatches = _kddbScore(provinces);
  renderKddb();
}

// ── Matching ──────────────────────────────────────────────────────────────────

function _kddbBuildRulerIdx() {
  const idx = {};
  _kddbIdentities.forEach(identity => {
    (identity.rulersSeen || []).forEach(r => {
      idx[r.toLowerCase()] = identity.id;
    });
  });
  return idx;
}

function _kddbScore(provinces) {
  const rulerIdx   = _kddbBuildRulerIdx();
  const scoreboard = {};

  provinces.forEach(p => {
    const key = (p.ruler || '').toLowerCase().trim();
    if (!key) return;
    const iid = rulerIdx[key];
    if (!iid) return;
    if (!scoreboard[iid]) scoreboard[iid] = { score: 0, rulerHits: 0, matchedRulers: [] };
    scoreboard[iid].rulerHits++;
    scoreboard[iid].matchedRulers.push(p.ruler);
  });

  Object.entries(scoreboard).forEach(([iid, s]) => {
    s.score += s.rulerHits >= 4 ? 90 : s.rulerHits >= 2 ? 60 : 30;
    const identity = _kddbIdentities.find(i => i.id === iid);
    if (identity) s.score += _kddbRaceScore(provinces, identity.raceCounts || {});
  });

  return Object.entries(scoreboard)
    .map(([iid, s]) => ({ identityId: iid, ...s }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function _kddbRaceScore(provinces, raceCounts) {
  const total     = provinces.length;
  const histTotal = Object.values(raceCounts).reduce((s, v) => s + v, 0);
  if (!total || !histTotal) return 0;
  const current = {};
  provinces.forEach(p => { current[p.race || ''] = (current[p.race || ''] || 0) + 1; });
  let overlap = 0;
  Object.entries(current).forEach(([race, cnt]) => {
    overlap += Math.min((raceCounts[race] || 0) / histTotal, cnt / total);
  });
  return Math.round(overlap * 15);
}

function _kddbConfidence(rulerHits) {
  if (rulerHits >= 4) return { label: 'STRONG',     color: '#60C040', bar: '█████' };
  if (rulerHits >= 2) return { label: 'GOOD GUESS', color: '#D4A017', bar: '████░' };
  return               { label: 'GUESS',       color: '#e09040', bar: '██░░░' };
}

// ── Confirm match ─────────────────────────────────────────────────────────────

async function _kddbConfirm(snapId, identityId) {
  if (!identityId) { alert('Select an identity first'); return; }
  $id('__wpc_kddb').innerHTML = loadingHTML('CONFIRMING...');

  const snap = await fbGet(`kd_snapshots/${snapId}`);
  if (!snap?.fields) { renderKddb(); return; }
  const snapData = Object.fromEntries(
    Object.entries(snap.fields).map(([k, v]) => [k, _fromFB(v)])
  );

  await fbWrite(`kd_snapshots/${snapId}`, { ...snapData, identityId });

  const identity = _kddbIdentities.find(i => i.id === identityId);
  if (identity) {
    const provinces = snapData.provinces || [];

    const rulerSet = new Set(identity.rulersSeen || []);
    provinces.forEach(p => { if (p.ruler) rulerSet.add(p.ruler); });

    const raceCounts = { ...(identity.raceCounts || {}) };
    provinces.forEach(p => { if (p.race) raceCounts[p.race] = (raceCounts[p.race] || 0) + 1; });

    const kdHistory = [...(identity.kdHistory || [])];
    if (!kdHistory.some(h => h.age === snapData.age && h.location === snapData.location)) {
      kdHistory.push({ age: snapData.age, location: snapData.location, kdName: snapData.kdName || '' });
    }

    const prevCount = identity.typicalProvinceCount || 0;
    const updated = {
      ...identity,
      rulersSeen:           [...rulerSet],
      raceCounts,
      kdHistory,
      typicalProvinceCount: prevCount
        ? Math.round((prevCount + provinces.length) / 2)
        : provinces.length,
    };

    await fbWrite(`kd_identities/${identityId}`, updated);
    const idx = _kddbIdentities.findIndex(i => i.id === identityId);
    if (idx >= 0) _kddbIdentities[idx] = updated;
  }

  if (_kddbSnapId === snapId) _kddbMatches = [];
  _kddbTagData = _kddbTagData.filter(d => _kddbSnapKey(d.age, d.location) !== snapId);

  renderKddb();
}

// ── Create / delete identities ────────────────────────────────────────────────

async function _kddbCreateIdentity(label, snapId) {
  if (!label.trim()) return;
  const id = _kddbNewId();
  const newIdentity = {
    id,
    label:               label.trim(),
    notes:               '',
    kdHistory:           [],
    rulersSeen:          [],
    raceCounts:          {},
    typicalProvinceCount: 0,
  };
  await fbWrite(`kd_identities/${id}`, newIdentity);
  _kddbIdentities.push(newIdentity);
  if (snapId) {
    await _kddbConfirm(snapId, id);
  } else {
    renderKddb();
  }
}

async function _kddbDeleteIdentity(identityId) {
  if (!confirm('Delete this identity? This cannot be undone.')) return;
  await fbDelete(`kd_identities/${identityId}`);
  _kddbIdentities = _kddbIdentities.filter(i => i.id !== identityId);
  renderKddb();
}

async function _kddbRenameIdentity(identityId) {
  const identity = _kddbIdentities.find(i => i.id === identityId);
  if (!identity) return;
  const newLabel = prompt(`Rename "${identity.label}" to:`, identity.label);
  if (!newLabel || !newLabel.trim() || newLabel.trim() === identity.label) return;
  const updated = { ...identity, label: newLabel.trim() };
  await fbWrite(`kd_identities/${identityId}`, updated);
  const idx = _kddbIdentities.findIndex(i => i.id === identityId);
  if (idx >= 0) _kddbIdentities[idx] = updated;
  renderKddb();
}

// ── Tag view ──────────────────────────────────────────────────────────────────

async function _kddbOpenTagView() {
  const age = _kddbGetAge();
  if (!age) { alert('Set the current age first (e.g. a114)'); return; }
  $id('__wpc_kddb').innerHTML = loadingHTML('LOADING UNTAGGED...');
  const docs = await fbQuery('kd_snapshots', [{ field: 'age', value: age }]);
  _kddbTagData = docs
    .filter(d => !d.identityId)
    .map(d => ({ ...d, matches: _kddbScore(d.provinces || []) }));
  _kddbView = 'tag';
  renderKddb();
}

// ── Identity list builder (used by both full render and live search) ──────────

function _kddbBuildIdRows() {
  const q        = (_kddbSearch || '').toLowerCase();
  const filtered = _kddbIdentities.filter(identity => {
    if (!q) return true;
    if ((identity.label || '').toLowerCase().includes(q)) return true;
    return (identity.rulersSeen || []).some(r => r.toLowerCase().includes(q));
  });

  if (!filtered.length) {
    return q
      ? `<div style="padding:16px 14px;color:#4a3010;font-style:italic;font-size:12px">No identities match "${esc(q)}".</div>`
      : `<div style="padding:16px 14px;color:#4a3010;font-style:italic;font-size:12px">No identities yet. Save &amp; Analyze an enemy KD to start building the database.</div>`;
  }

  return filtered.map(identity => {
    const rulers  = (identity.rulersSeen || []).join(', ');
    const races   = Object.entries(identity.raceCounts || {})
      .sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `${r}\xd7${c}`)
      .join('  ');
    const history = (identity.kdHistory || [])
      .map(h => `<span style="font-size:10px;color:#7a5a2a;background:#120d04;border:1px solid #2a1a08;border-radius:2px;padding:1px 5px">${esc(h.kdName)} (${esc(h.age)})</span>`)
      .join(' ');
    return `
      <div style="padding:12px 14px;border-bottom:1px solid #2a1a08;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${history || rulers || races ? '6px' : '0'}">
          <span style="font-size:14px;font-weight:700;color:#c8a060">${esc(identity.label)}</span>
          ${identity.typicalProvinceCount ? `<span style="font-size:10px;color:#4a3010">~${identity.typicalProvinceCount} provs</span>` : ''}
          <button onclick="__wpA.kddbRename('${esc(identity.id)}')"
            style="background:none;border:none;color:#4a3010;cursor:pointer;font-size:11px;padding:2px 6px"
            title="Rename identity">&#x270e; Rename</button>
          <button onclick="__wpA.kddbDelete('${esc(identity.id)}')"
            style="margin-left:auto;background:none;border:none;color:#4a3010;cursor:pointer;font-size:12px;padding:2px 6px"
            title="Delete identity">&#x2715;</button>
        </div>
        ${history ? `<div style="margin-bottom:5px;display:flex;flex-wrap:wrap;gap:4px">${history}</div>` : ''}
        ${rulers   ? `<div style="font-size:11px;color:#7a5a2a;margin-bottom:3px">Rulers: ${esc(rulers)}</div>` : ''}
        ${races    ? `<div style="font-size:11px;color:#4a3010">${esc(races)}</div>` : ''}
      </div>`;
  }).join('');
}

// ── Render ────────────────────────────────────────────────────────────────────

async function renderKddb() {
  if (!_kddbLoaded) {
    $id('__wpc_kddb').innerHTML = loadingHTML('LOADING DATABASE...');
    await _kddbLoadAll();
  }
  renderTab('__wpc_kddb', _kddbView === 'tag' ? _buildTagView : _buildMainView);
}

function _buildMainView() {
  const age      = _kddbGetAge();
  const hasEnemy = !!S.enemy;
  const kdName   = hasEnemy ? (S.enemy.kingdomName || S.eLoc) : '—';
  const snapId   = _kddbSnapId;
  const canSave  = hasEnemy && !!age;

  const toolbar = `
    <div class="webar">
      <label>Age</label>
      <input id="__wpkddb_age" value="${esc(age)}" placeholder="a114" style="width:70px"
        onblur="__wpA.kddbSetAge(this.value)"
        onkeydown="if(event.key==='Enter')__wpA.kddbSetAge(this.value)">
      <div style="flex:1;font-size:12px;color:#7a5a2a;">
        ${hasEnemy
          ? `<b style="color:#c8a060">${esc(kdName)}</b> <span style="color:#4a3010">${esc(S.eLoc)}</span> · ${S.enemy.provinces.length} provinces`
          : '<i>No enemy loaded</i>'}
      </div>
      <button class="wb g" onclick="__wpA.kddbSave()" ${canSave ? '' : 'disabled style="opacity:.5"'}>💾 Save &amp; Analyze</button>
      <button class="wb" onclick="__wpA.kddbTagAll()" ${age ? '' : 'disabled style="opacity:.5"'}>⚑ Tag untagged this age</button>
    </div>`;

  // ── Current enemy province list ──
  let provinceHtml = '';
  if (hasEnemy) {
    const rulerIdx  = _kddbBuildRulerIdx();
    const provRows  = (S.enemy.provinces || []).map(p => {
      const ruler = p.sot?.ruler || '—';
      const known = ruler !== '—' && rulerIdx[ruler.toLowerCase()];
      const identity = known ? _kddbIdentities.find(i => i.id === known) : null;
      return `
        <tr style="border-bottom:1px solid #1e1208;">
          <td style="padding:4px 10px;color:#7a5a2a;font-size:11px">${p.slot}</td>
          <td style="padding:4px 10px;color:#c8a060;font-size:12px">${esc(p.name || '—')}</td>
          <td style="padding:4px 10px;font-size:12px;color:${identity ? '#60C040' : '#c8a060'};font-weight:${identity ? '700' : '400'}">${esc(ruler)}</td>
          <td style="padding:4px 10px;color:#7a5a2a;font-size:11px">${esc(p.race || '—')}</td>
          <td style="padding:4px 10px;color:#7a5a2a;font-size:11px">${esc(p.sot?.personality || '—')}</td>
          <td style="padding:4px 10px;font-size:10px;color:#4a3010">${identity ? esc(identity.label) : ''}</td>
        </tr>`;
    }).join('');
    provinceHtml = `
      <div style="margin-bottom:16px;border:1px solid #3a2810;border-radius:4px;background:#1a1208;overflow:hidden">
        <div style="padding:8px 14px;background:#120d04;border-bottom:1px solid #3a2810;font-size:11px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase">
          ${esc(kdName)} — Provinces &amp; Rulers
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:1px solid #2a1a08">
              <th style="padding:5px 10px;text-align:left;font-size:9px;font-weight:700;color:#4a3010;letter-spacing:1px;text-transform:uppercase">#</th>
              <th style="padding:5px 10px;text-align:left;font-size:9px;font-weight:700;color:#4a3010;letter-spacing:1px;text-transform:uppercase">Province</th>
              <th style="padding:5px 10px;text-align:left;font-size:9px;font-weight:700;color:#4a3010;letter-spacing:1px;text-transform:uppercase">Ruler</th>
              <th style="padding:5px 10px;text-align:left;font-size:9px;font-weight:700;color:#4a3010;letter-spacing:1px;text-transform:uppercase">Race</th>
              <th style="padding:5px 10px;text-align:left;font-size:9px;font-weight:700;color:#4a3010;letter-spacing:1px;text-transform:uppercase">Personality</th>
              <th style="padding:5px 10px;text-align:left;font-size:9px;font-weight:700;color:#4a3010;letter-spacing:1px;text-transform:uppercase">Known as</th>
            </tr></thead>
            <tbody>${provRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Match results — always shown after Save & Analyze ──
  let matchHtml = '';
  if (snapId) {
    const matchRows = _kddbMatches.map((m, i) => {
      const identity = _kddbIdentities.find(id => id.id === m.identityId);
      if (!identity) return '';
      const conf   = _kddbConfidence(m.rulerHits);
      const rulers = (m.matchedRulers || []).map(r => `<span class="wtag">${esc(r)} &#x2713;</span>`).join('');
      const last   = (identity.kdHistory || []).slice(-1)[0];
      const hist   = last
        ? `<span style="font-size:10px;color:#7a5a2a">Was: <b>${esc(last.kdName)}</b> @ ${esc(last.location)} (${esc(last.age)})</span>`
        : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #2a1a08;${i === 0 ? 'background:#1e1508' : ''}">
          <div style="min-width:22px;font-weight:700;color:#7a5a2a;font-size:12px">${i + 1}.</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
              <span style="font-size:14px;font-weight:700;color:#c8a060">${esc(identity.label)}</span>
              <span style="font-size:11px;font-weight:700;color:${conf.color};font-family:monospace">${conf.bar} ${conf.label}</span>
            </div>
            <div style="margin-bottom:4px">${rulers}</div>
            ${hist}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <button class="wb g" style="font-size:11px;padding:4px 10px"
              onclick="__wpA.kddbConfirm('${esc(snapId)}','${esc(identity.id)}')">&#x2713; Confirm</button>
            <button class="wb r" style="font-size:11px;padding:4px 10px"
              onclick="__wpA.kddbWrong('${esc(m.identityId)}')">&#x2717; Wrong</button>
          </div>
        </div>`;
    }).join('');

    const idOptions = _kddbIdentities
      .map(id => `<option value="${esc(id.id)}">${esc(id.label)}</option>`)
      .join('');

    matchHtml = `
      <div style="margin-bottom:20px;border:1px solid #3a2810;border-radius:4px;background:#1a1208;overflow:hidden">
        <div style="padding:10px 14px;background:#120d04;border-bottom:1px solid #3a2810;font-size:11px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase">
          Match Results — ${esc(kdName)}
        </div>
        ${matchRows || '<div style="padding:12px 14px;color:#4a3010;font-style:italic;font-size:12px">No ruler matches found — this may be a new kingdom or one not yet in the database.</div>'}
        <div style="padding:10px 14px;border-top:1px solid #2a1a08;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input id="__wpkddb_newlabel" placeholder="New identity name (real name)..."
            style="background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:13px;padding:6px 10px;border-radius:3px;flex:1;min-width:160px;outline:none">
          <button class="wb g" onclick="__wpA.kddbCreate(document.getElementById('__wpkddb_newlabel').value,'${esc(snapId)}')">
            + Create &amp; Tag
          </button>
          <span style="font-size:11px;color:#4a3010">or link to existing:</span>
          <select id="__wpkddb_linksel"
            style="background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:12px;padding:5px 8px;border-radius:3px;outline:none">
            <option value="">— select identity —</option>
            ${idOptions}
          </select>
          <button class="wb" onclick="__wpA.kddbConfirm('${esc(snapId)}',document.getElementById('__wpkddb_linksel').value)">
            Link
          </button>
        </div>
      </div>`;
  }

  // ── Identity browser ──
  const browser = `
    <div style="border:1px solid #3a2810;border-radius:4px;background:#1a1208;overflow:hidden">
      <div style="padding:10px 14px;background:#120d04;border-bottom:1px solid #3a2810;display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;font-weight:700;color:#7a5a2a;letter-spacing:1px;text-transform:uppercase">
          Known Identities (${_kddbIdentities.length})
        </span>
        <input id="__wpkddb_search" placeholder="Search by name or ruler..."
          value="${esc(_kddbSearch)}"
          oninput="__wpA.kddbSearch(this.value)"
          style="flex:1;background:#1a1208;border:1px solid #2a1a08;color:#c8a060;font-size:12px;padding:4px 8px;border-radius:3px;outline:none">
        <button class="wb" style="font-size:11px;padding:4px 10px" onclick="__wpA.kddbCreateNew()">+ New Identity</button>
      </div>
      <div id="__wpkddb_idlist">${_kddbBuildIdRows()}</div>
    </div>`;

  return `${toolbar}${provinceHtml}${matchHtml}${browser}`;
}

function _buildTagView() {
  const age  = _kddbGetAge();

  const rows = _kddbTagData.map((snap, i) => {
    const snapId   = _kddbSnapKey(snap.age, snap.location);
    const topMatch = snap.matches[0];
    const identity = topMatch ? _kddbIdentities.find(id => id.id === topMatch.identityId) : null;
    const conf     = topMatch ? _kddbConfidence(topMatch.rulerHits) : null;
    const rulers   = (snap.provinces || []).map(p => p.ruler).filter(Boolean).slice(0, 7).join(', ');
    const idOptions = _kddbIdentities
      .map(id => `<option value="${esc(id.id)}" ${identity && id.id === identity.id ? 'selected' : ''}>${esc(id.label)}</option>`)
      .join('');
    return `
      <div style="padding:12px 14px;border-bottom:1px solid #2a1a08;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:7px">
          <div style="flex:1">
            <span style="font-size:14px;font-weight:700;color:#c8a060">${esc(snap.kdName || snap.location)}</span>
            <span style="font-size:11px;color:#4a3010;margin-left:8px">${esc(snap.location)}</span>
            <span style="font-size:11px;color:#4a3010;margin-left:8px">${(snap.provinces || []).length} provs</span>
          </div>
          ${conf ? `<span style="font-size:11px;font-weight:700;color:${conf.color};font-family:monospace">${conf.bar} ${conf.label}</span>` : ''}
        </div>
        ${rulers ? `<div style="font-size:11px;color:#7a5a2a;margin-bottom:8px">Rulers: ${esc(rulers)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:8px">
          <select id="__wpkddb_ts_${i}"
            style="background:#120d04;border:1px solid #3a2810;color:#c8a060;font-size:12px;padding:4px 8px;border-radius:3px;flex:1;outline:none">
            <option value="">— select identity —</option>
            ${idOptions}
          </select>
          <button class="wb g" style="font-size:11px;padding:4px 10px"
            onclick="__wpA.kddbTagConfirm('${esc(snapId)}',document.getElementById('__wpkddb_ts_${i}').value)">
            ✓ Confirm
          </button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="webar" style="justify-content:space-between;margin-bottom:16px">
      <span style="font-size:13px;font-weight:700;color:#D4A017">⚑ Tag Untagged KDs — ${esc(age)}</span>
      <span style="font-size:11px;color:#7a5a2a">${_kddbTagData.length} untagged</span>
      <button class="wb" onclick="__wpA.kddbTagBack()">← Back</button>
    </div>
    <div style="border:1px solid #3a2810;border-radius:4px;background:#1a1208;overflow:hidden">
      ${_kddbTagData.length === 0
        ? '<div style="padding:16px;color:#4a3010;font-style:italic;font-size:12px">All kingdoms for this age are tagged — or no snapshots recorded yet.</div>'
        : rows}
    </div>`;
}
