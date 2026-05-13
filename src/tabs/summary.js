// ── TAB: SUMMARY ───────────────────────────────────────────────────────────

function renderSummary() {
  renderTab('__wpc_summary', _buildSummary);
}

function _buildSummary() {
  if (!S.own || !S.enemy) return '';

  const waveTargets = S.enemy ? S.enemy.provinces
    .filter(p => S.provinces[p.slot]?.wave)
    .map(p => ({
      province: { slot: '['+p.slot+']', name: p.name, race: p.race,
                  requiredOps: S.provinces[p.slot]?.requiredOps || [],
                  notes: S.provinces[p.slot]?.notes || '' },
    })) : [];
  const unassigned = S.enemy ? S.enemy.provinces.filter(p => !S.provinces[p.slot]?.wave).length : 0;
  const attackers   = S.own.provinces.filter(p => (p.som?.offPointsHome || 0) > 0);
  const totalOff    = attackers.reduce((s, p) => s + (p.som?.offPointsHome || 0), 0);
  const totalDef    = S.enemy.provinces.reduce((s, p) => s + (p.calcs?.defPointsSummary?.defPointsHome || 0), 0);

  const summaryCards = `
    <div class="wsum">
      <div class="wscard"><div class="l">Targets</div><div class="v">${waveTargets.length}</div><div class="s">${unassigned} unassigned</div></div>
      <div class="wscard"><div class="l">Attackers</div><div class="v">${attackers.length}</div><div class="s">with SoM data</div></div>
      <div class="wscard"><div class="l">Total Off</div><div class="v">${fK(totalOff)}</div></div>
      <div class="wscard"><div class="l">Enemy Def</div><div class="v">${fK(totalDef)}</div><div class="s">known</div></div>
    </div>`;

  const rows = waveTargets.map(item => {
    const p     = pd(item.province.slot);
    const def   = p?.calcs?.defPointsSummary?.defPointsHome || 0;
    const da    = p?.calcs?.defPointsSummary?.ageSeconds;
    const ops   = item.province.requiredOps || [];
    const away  = p?.som?.armiesAway?.length > 0;
    const brk   = attackers.filter(a => canHit(a.networth, p?.networth || 1) && (a.som?.offPointsHome || 0) > def * 1.01).length;
    const pct   = attackers.length > 0 ? Math.round(brk / attackers.length * 100) : 0;
    const pctColor = pct >= 50 ? '#60C040' : pct > 0 ? '#e09040' : '#E05050';

    return `<tr>
      <td style="font-weight:700">${esc(item.province.name)}</td>
      <td style="color:#7a5a2a">${esc(item.province.race || '')}</td>
      <td>${fK(def)}</td>
      <td>${ops.map(o => `<span class="wtag" style="cursor:default;font-size:8px">${o}</span>`).join('') || '—'}</td>
      <td>${brk}/${attackers.length} <span style="color:${pctColor}">(${pct}%)</span></td>
      <td><span class="${aC(da)}">${fA(da)}</span></td>
      <td>${away ? '<span style="color:#60C040">AWAY</span>' : '—'}</td>
    </tr>`;
  }).join('');

  return `${summaryCards}
    ${sectionHead('Target Coverage')}
    <table class="wtbl">
      <thead><tr>
        <th>Province</th><th>Race</th><th>Def Home</th>
        <th>Ops</th><th>Breakers</th><th>Intel</th><th>Army</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
