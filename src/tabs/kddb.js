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
  setTimeout(() => renderKddb(), 0);
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
  // Read age from DOM input directly (in case user typed but didn't blur)
  const ageInput = $id('__wpkddb_age');
  const age = (ageInput?.value.trim()) || _kddbGetAge();
  const loc = S.eLoc || '';
  console.log('[WavePlanner] kddb save: age=', age, 'loc=', loc, 'enemy=', !!S.enemy);

  if (!age)     { alert('Enter the current age first (e.g. a114)'); return; }
  if (!S.enemy) { alert('No enemy kingdom loaded'); return; }
  if (!loc) { alert('Enemy location not set — reload the Wave Planner from the Intel Site'); return; }

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
  try {
    const result = await fbWrite(`kd_snapshots/${snapKey}`, {
      age,
      location:   loc,
      kdName:     S.enemy.kingdomName || loc,
      savedAt:    new Date().toISOString(),
      identityId: '',
      provinces,
    });
    if (!result || result.error) {
      const msg = result?.error?.message || 'Unknown error';
      console.error('[WavePlanner] kddb snapshot write failed:', msg, 'path:', snapKey);
      $id('__wpc_kddb').innerHTML = `<div class="wload" style="color:#ff4455">Save failed: ${esc(msg)}<br><small style="color:#666">Key: ${esc(snapKey)}</small></div>`;
      return;
    }
  } catch(e) {
    console.error('[WavePlanner] kddb save error:', e);
    $id('__wpc_kddb').innerHTML = `<div class="wload" style="color:#ff4455">Save error: ${esc(e.message)}</div>`;
    return;
  }

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
      ? `<div style="padding:20px 16px;color:#7a9090;font-style:italic;font-size:13px">No identities match &ldquo;${esc(q)}&rdquo;.</div>`
      : `<div style="padding:20px 16px;color:#7a9090;font-style:italic;font-size:13px">No identities yet. Save &amp; Analyze an enemy kingdom to start building the database.</div>`;
  }

  return filtered.map(identity => {
    const rulers  = (identity.rulersSeen || []).join(', ');
    const history = (identity.kdHistory || [])
      .map(h => `<span style="font-size:11px;color:#ffd400;background:#7a6500;border-radius:3px;padding:2px 7px;font-weight:700;letter-spacing:.3px">${esc(h.kdName || h.location)} (${esc(h.age)})</span>`)
      .join(' ');
    return `
      <div style="padding:14px 16px;border-bottom:1px solid rgba(97,112,112,.3);"
           onmouseover="this.style.background='rgba(255,212,0,.07)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${history || rulers ? '8px' : '0'}">
          <span style="font-size:15px;font-weight:700;color:#ffffff">${esc(identity.label)}</span>
          ${identity.typicalProvinceCount ? `<span style="font-size:11px;color:#7a9090">~${identity.typicalProvinceCount} provs</span>` : ''}
          <button onclick="__wpA.kddbRename('${esc(identity.id)}')"
            style="background:none;border:1px solid #617070;color:#b8c8c8;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:3px;margin-left:auto"
            title="Rename identity">&#x270e; Rename</button>
          <button onclick="__wpA.kddbDelete('${esc(identity.id)}')"
            style="background:none;border:1px solid rgba(255,80,80,.4);color:#ff8888;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:3px"
            title="Delete identity">&#x2715;</button>
        </div>
        ${history ? `<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:4px">${history}</div>` : ''}
        ${rulers  ? `<div style="font-size:12px;color:#7a9090;line-height:1.6"><b style="color:#b8c8c8">Rulers:</b> ${esc(rulers)}</div>` : ''}
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
  const age      = $id('__wpkddb_age')?.value.trim() || _kddbGetAge();
  const hasEnemy = !!S.enemy;
  const kdName   = hasEnemy ? (S.enemy.kingdomName || S.eLoc) : '—';
  const snapId   = _kddbSnapId;
  const canSave  = hasEnemy;

  // ── Toolbar ──
  const toolbar = `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#2b3333;border:1px solid #617070;border-radius:6px;margin-bottom:16px;flex-wrap:wrap">
      <label style="font-size:10px;font-weight:700;color:#7a9090;letter-spacing:1.5px;text-transform:uppercase">AGE</label>
      <input id="__wpkddb_age" value="${esc(age)}" placeholder="a114"
        style="width:68px;background:#323d3d;border:1px solid #617070;color:#ffd400;font-size:14px;font-weight:700;padding:6px 10px;border-radius:4px;outline:none"
        onblur="__wpA.kddbSetAge(this.value)"
        onkeydown="if(event.key==='Enter')__wpA.kddbSetAge(this.value)">
      <div style="flex:1;min-width:120px">
        ${hasEnemy
          ? `<span style="font-size:15px;font-weight:700;color:#ffd400">${esc(kdName)}</span>
             <span style="font-size:13px;color:#7a9090;margin-left:8px">${esc(S.eLoc)}</span>
             <span style="font-size:12px;color:#7a9090;margin-left:4px">· ${S.enemy.provinces.length} provinces</span>`
          : '<i style="color:#7a9090;font-size:13px">No enemy loaded</i>'}
      </div>
      <button style="background:#ffd400;color:#1e2828;border:none;padding:8px 16px;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;${canSave ? '' : 'opacity:.4;cursor:not-allowed'}"
        onclick="__wpA.kddbSave()" ${canSave ? '' : 'disabled'}>&#x1f4be; Save &amp; Analyze</button>
      <button style="background:none;border:1px solid #617070;color:#b8c8c8;padding:8px 14px;border-radius:4px;font-size:13px;cursor:pointer;${age ? '' : 'opacity:.4;cursor:not-allowed'}"
        onclick="__wpA.kddbTagAll()" ${age ? '' : 'disabled'}>&#x2691; Tag untagged this age</button>
    </div>`;

  // ── Province table ──
  let provinceHtml = '';
  if (hasEnemy) {
    const rulerIdx = _kddbBuildRulerIdx();
    const TH = 'padding:8px 14px;text-align:left;font-size:10px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #617070';
    const provRows = (S.enemy.provinces || []).map(p => {
      const ruler    = p.sot?.ruler || '—';
      const known    = ruler !== '—' && rulerIdx[ruler.toLowerCase()];
      const identity = known ? _kddbIdentities.find(i => i.id === known) : null;
      return `
        <tr onmouseover="this.style.background='rgba(255,212,0,.07)'" onmouseout="this.style.background=''">
          <td style="padding:9px 14px;color:#7a9090;font-size:12px;border-bottom:1px solid rgba(97,112,112,.25)">${p.slot}</td>
          <td style="padding:9px 14px;color:#ffffff;font-size:13px;font-weight:500;border-bottom:1px solid rgba(97,112,112,.25)">${esc(p.name || '—')}</td>
          <td style="padding:9px 14px;font-size:13px;font-weight:600;color:${identity ? '#ffd400' : '#b8c8c8'};border-bottom:1px solid rgba(97,112,112,.25)">${esc(ruler)}</td>
          <td style="padding:9px 14px;color:#b8c8c8;font-size:13px;border-bottom:1px solid rgba(97,112,112,.25)">${esc(p.race || '—')}</td>
          <td style="padding:9px 14px;color:#b8c8c8;font-size:13px;border-bottom:1px solid rgba(97,112,112,.25)">${esc(p.sot?.personality || '—')}</td>
          <td style="padding:9px 14px;font-size:12px;font-weight:700;color:#60d060;border-bottom:1px solid rgba(97,112,112,.25)">${identity ? esc(identity.label) : ''}</td>
        </tr>`;
    }).join('');
    provinceHtml = `
      <div style="margin-bottom:16px;border:1px solid #617070;border-radius:6px;background:#3c4545;overflow:hidden">
        <div style="padding:10px 16px;background:#2b3333;border-bottom:1px solid #617070;font-size:11px;font-weight:700;color:#7a9090;letter-spacing:1.5px;text-transform:uppercase">
          ${esc(kdName)} &mdash; Provinces &amp; Rulers
          <span style="font-weight:400;color:#617070;margin-left:8px;letter-spacing:0">· gold rulers are already indexed</span>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr>
              <th style="${TH}">#</th>
              <th style="${TH}">Province</th>
              <th style="${TH}">Ruler</th>
              <th style="${TH}">Race</th>
              <th style="${TH}">Personality</th>
              <th style="${TH}">Known As</th>
            </tr></thead>
            <tbody>${provRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Match results ──
  let matchHtml = '';
  if (snapId) {
    const matchRows = _kddbMatches.map((m, i) => {
      const identity = _kddbIdentities.find(id => id.id === m.identityId);
      if (!identity) return '';
      const conf   = _kddbConfidence(m.rulerHits);
      const rulers = (m.matchedRulers || []).map(r => `<span style="display:inline-block;background:#7a6500;color:#ffd400;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;margin:1px">${esc(r)} &#x2713;</span>`).join(' ');
      const last   = (identity.kdHistory || []).slice(-1)[0];
      const hist   = last
        ? `<div style="font-size:11px;color:#7a9090;margin-top:4px">Was: <b style="color:#b8c8c8">${esc(last.kdName || last.location)}</b> @ ${esc(last.location)} (${esc(last.age)})</div>`
        : '';
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(97,112,112,.3);${i === 0 ? 'background:#323d3d' : ''}">
          <div style="min-width:22px;font-weight:700;color:#7a9090;font-size:13px">${i + 1}.</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:15px;font-weight:700;color:#ffffff">${esc(identity.label)}</span>
              <span style="font-size:11px;font-weight:700;color:${conf.color};font-family:monospace">${conf.bar} ${conf.label}</span>
            </div>
            <div style="margin-bottom:2px">${rulers}</div>
            ${hist}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <button style="background:#ffd400;color:#1e2828;border:none;padding:6px 12px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer"
              onclick="__wpA.kddbConfirm('${esc(snapId)}','${esc(identity.id)}')">&#x2713; Confirm</button>
            <button style="background:none;border:1px solid rgba(255,80,80,.4);color:#ff8888;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer"
              onclick="__wpA.kddbWrong('${esc(m.identityId)}')">&#x2717; Wrong</button>
          </div>
        </div>`;
    }).join('');

    const idOptions = _kddbIdentities
      .map(id => `<option value="${esc(id.id)}">${esc(id.label)}</option>`)
      .join('');

    matchHtml = `
      <div style="margin-bottom:16px;border:1px solid #617070;border-radius:6px;background:#3c4545;overflow:hidden">
        <div style="padding:10px 16px;background:#2b3333;border-bottom:1px solid #617070;font-size:11px;font-weight:700;color:#7a9090;letter-spacing:1.5px;text-transform:uppercase">
          Match Results &mdash; ${esc(kdName)}
        </div>
        ${matchRows || '<div style="padding:14px 16px;color:#7a9090;font-style:italic;font-size:13px">No ruler matches found &mdash; this may be a new kingdom not yet in the database.</div>'}
        <div style="padding:12px 16px;border-top:1px solid rgba(97,112,112,.4);display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#2b3333">
          <input id="__wpkddb_newlabel" placeholder="New identity name (real name)..."
            style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-size:13px;padding:7px 10px;border-radius:4px;flex:1;min-width:150px;outline:none">
          <button style="background:#ffd400;color:#1e2828;border:none;padding:8px 14px;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap"
            onclick="__wpA.kddbCreate(document.getElementById('__wpkddb_newlabel').value,'${esc(snapId)}')">+ Create &amp; Tag</button>
          <span style="font-size:12px;color:#7a9090;white-space:nowrap">or link:</span>
          <select id="__wpkddb_linksel"
            style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-size:13px;padding:7px 8px;border-radius:4px;outline:none;flex:1;min-width:140px">
            <option value="">— select identity —</option>
            ${idOptions}
          </select>
          <button style="background:none;border:1px solid #617070;color:#b8c8c8;padding:8px 14px;border-radius:4px;font-size:13px;cursor:pointer"
            onclick="__wpA.kddbConfirm('${esc(snapId)}',document.getElementById('__wpkddb_linksel').value)">Link</button>
        </div>
      </div>`;
  }

  // ── Identity browser ──
  const browser = `
    <div style="border:1px solid #617070;border-radius:6px;background:#3c4545;overflow:hidden">
      <div style="padding:10px 16px;background:#2b3333;border-bottom:1px solid #617070;display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;font-weight:700;color:#7a9090;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap">
          Known Identities (${_kddbIdentities.length})
        </span>
        <input id="__wpkddb_search" placeholder="Search by name or ruler..."
          value="${esc(_kddbSearch)}"
          oninput="__wpA.kddbSearch(this.value)"
          style="flex:1;background:#3c4545;border:1px solid #617070;color:#ffffff;font-size:13px;padding:7px 10px;border-radius:4px;outline:none">
        <button style="background:#ffd400;color:#1e2828;border:none;padding:7px 13px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap"
          onclick="__wpA.kddbCreateNew()">+ New Identity</button>
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
      <div style="padding:14px 16px;border-bottom:1px solid rgba(97,112,112,.3);"
           onmouseover="this.style.background='rgba(255,212,0,.07)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <div style="flex:1">
            <span style="font-size:14px;font-weight:700;color:#ffffff">${esc(snap.kdName || snap.location)}</span>
            <span style="font-size:12px;color:#7a9090;margin-left:8px">${esc(snap.location)}</span>
            <span style="font-size:12px;color:#7a9090;margin-left:4px">· ${(snap.provinces || []).length} provs</span>
          </div>
          ${conf ? `<span style="font-size:11px;font-weight:700;color:${conf.color};font-family:monospace">${conf.bar} ${conf.label}</span>` : ''}
        </div>
        ${rulers ? `<div style="font-size:12px;color:#7a9090;margin-bottom:10px"><b style="color:#b8c8c8">Rulers:</b> ${esc(rulers)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:8px">
          <select id="__wpkddb_ts_${i}"
            style="background:#3c4545;border:1px solid #617070;color:#ffffff;font-size:13px;padding:6px 8px;border-radius:4px;flex:1;outline:none">
            <option value="">— select identity —</option>
            ${idOptions}
          </select>
          <button style="background:#ffd400;color:#1e2828;border:none;padding:7px 14px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap"
            onclick="__wpA.kddbTagConfirm('${esc(snapId)}',document.getElementById('__wpkddb_ts_${i}').value)">
            &#x2713; Confirm
          </button>
        </div>
      </div>`;
  }).join('');

  return `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#2b3333;border:1px solid #617070;border-radius:6px;margin-bottom:16px">
      <span style="font-size:13px;font-weight:700;color:#ffd400">&#x2691; Tag Untagged KDs &mdash; ${esc(age)}</span>
      <span style="font-size:12px;color:#7a9090">${_kddbTagData.length} untagged</span>
      <button style="background:none;border:1px solid #617070;color:#b8c8c8;padding:6px 14px;border-radius:4px;font-size:13px;cursor:pointer;margin-left:auto"
        onclick="__wpA.kddbTagBack()">&#x2190; Back</button>
    </div>
    <div style="border:1px solid #617070;border-radius:6px;background:#3c4545;overflow:hidden">
      ${_kddbTagData.length === 0
        ? '<div style="padding:20px 16px;color:#7a9090;font-style:italic;font-size:13px">All kingdoms for this age are tagged &mdash; or no snapshots recorded yet.</div>'
        : rows}
    </div>`;
}
