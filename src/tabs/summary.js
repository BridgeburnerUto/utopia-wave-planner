// ── TAB: WAVE PLAN (formerly Summary — old coverage table dropped) ──────────
// Leader-facing wave planner UI on top of the solver in waveplan.js:
// generate → review/tweak the ordered hit sequence → publish.
// Publishing stores waveSeq in the war plan JSON, derives assignedTo per
// target for board/My Orders compat, and posts the full hitlist to Discord.
// Internal tab key stays 'summary' (ids __wpt_summary/__wpc_summary).

function renderWavePlan() {
  renderTab('__wpc_summary', _buildWavePlan);
}

function _wpFmtTime(s) { return s <= 0 ? 'now' : '+' + fA(s); }

function _wpRangeBadge(range) {
  if (range === 'optimal') return '<span class="wmatch wmyes">optimal</span>';
  if (range === 'ok')      return '<span class="wmatch wmyes" style="opacity:.75">good</span>';
  return '<span class="wmatch wmno">OUT</span>';
}

/** The sequence being viewed/edited: draft wins over published. */
function _wpActiveSeq() { return S.waveDraft || S.waveSeq || null; }

/** Ensure edits happen on a draft copy (published plans are edited as a new draft). */
function _wpEditableDraft() {
  if (!S.waveDraft && S.waveSeq) S.waveDraft = S.waveSeq.map(h => ({ ...h }));
  return S.waveDraft;
}

// ── Actions (exposed through __wpA) ─────────────────────────────────────────

function generateWavePlan() {
  const r = generateWaveSeq(S.waveType);
  S.waveDraft = r.seq;
  S.waveGenAt = Date.now();
  S._waveGen  = { uncovered: r.uncovered, idleSlots: r.idleSlots,
                  ambushHolds: r.ambushHolds, chainStatus: r.chainStatus };
  renderWavePlan();
}

function setWaveType(v) {
  S.waveType = v || 'standard';
  renderWavePlan();
}

function discardWaveDraft() {
  S.waveDraft = null;
  S._waveGen  = null;
  renderWavePlan();
}

function wpRemoveHit(n) {
  const draft = _wpEditableDraft();
  if (!draft) return;
  const r = resimulateWaveSeq(draft.filter(h => h.n !== n));
  S.waveDraft = r.seq;
  S._waveGen = { ...(S._waveGen || {}), ambushHolds: r.ambushHolds, chainStatus: r.chainStatus };
  renderWavePlan();
}

function wpReassign(n, slotKey) {
  const draft = _wpEditableDraft();
  if (!draft || !slotKey) return;
  const hit = draft.find(h => h.n === n);
  if (!hit) return;
  hit.slotKey = slotKey;
  const r = resimulateWaveSeq(draft);
  S.waveDraft = r.seq;
  S._waveGen = { ...(S._waveGen || {}), ambushHolds: r.ambushHolds, chainStatus: r.chainStatus };
  renderWavePlan();
}

async function publishWavePlan() {
  const seq = _wpActiveSeq();
  if (!seq?.length) return;
  const marginals = seq.filter(h => h.marginal || h.risky).length;
  const ok = confirm(
    `Publish this wave plan?\n\n${seq.length} hits` +
    (marginals ? ` (${marginals} marginal/risky)` : '') +
    `\n\nThis overwrites target assignments, saves the shared plan` +
    (S.discordWebhook ? ` and posts the hitlist to Discord.` : `.`));
  if (!ok) return;

  S.waveSeq   = seq.map(h => ({ ...h }));
  S.waveDraft = null;

  // Derive assignedTo for every flagged target that appears in the sequence
  const byTarget = {};
  for (const h of S.waveSeq) {
    if (h.isWall) continue;
    (byTarget[h.targetSlot] = byTarget[h.targetSlot] || new Set()).add(h.attacker);
  }
  for (const [slot, names] of Object.entries(byTarget)) {
    if (S.provinces[slot]) S.provinces[slot].assignedTo = [...names];
  }

  await window.__wpA.save();
  if (S.discordWebhook) {
    const sent = await postWaveSeqToDiscord(S.waveSeq);
    setSav(sent ? 'Published + posted to Discord ✓' : 'Published — Discord post FAILED', sent ? 'ok' : 'err');
  } else {
    setSav('Published ✓ (no Discord webhook set)', 'ok');
  }
  setTimeout(() => setSav('', ''), 4000);
  renderWavePlan();
  renderBoard();
  renderPlayer();
}

// ── Render ───────────────────────────────────────────────────────────────────

function _buildWavePlan() {
  if (!S.own || !S.enemy) return '<div class="watk-noprov">Loading data...</div>';

  const flaggedCount = S.enemy.provinces.filter(p => S.provinces[p.slot]?.wave).length;
  const slots = buildWaveSlots();
  const seq   = _wpActiveSeq();
  const isDraft = !!S.waveDraft;

  const strayProvs = [...new Set(slots.filter(s => s.stray).map(s => s.attacker))];

  // Status line
  const status = isDraft
    ? '<span style="color:#ffd400;font-weight:700">DRAFT — not published</span>'
    : S.waveSeq ? '<span style="color:#60C040;font-weight:700">PUBLISHED</span>'
    : '<span style="color:#7a9090">no plan generated yet</span>';

  // Cards
  const covered = seq ? new Set(seq.filter(h => !h.isWall).map(h => h.targetSlot)).size : 0;
  const totalGains = seq ? seq.reduce((s, h) => s + (h.estGain || 0), 0) : 0;
  let h = `
    <div class="wsum">
      <div class="wscard"><div class="l">Attack Slots</div><div class="v">${slots.length}</div>
        <div class="s">${strayProvs.length ? strayProvs.length + ' stray-army prov' + (strayProvs.length > 1 ? 's' : '') : 'incl. army returns'}</div></div>
      <div class="wscard"><div class="l">Hits Planned</div><div class="v">${seq ? seq.length : '—'}</div><div class="s">${status}</div></div>
      <div class="wscard"><div class="l">Targets Covered</div><div class="v">${seq ? covered + '/' + flaggedCount : '—/' + flaggedCount}</div><div class="s">flagged on board</div></div>
      <div class="wscard"><div class="l">Est. Gains</div><div class="v">${totalGains ? '~' + fK(totalGains) : '—'}</div><div class="s">acres, TM only</div></div>
    </div>`;

  // Action bar
  h += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <select onchange="__wpA.setWaveType(this.value)" title="Wave type — more types coming"
      style="background:#2b3333;border:1px solid #617070;color:#ffffff;font-size:17px;padding:6px 8px;border-radius:3px;cursor:pointer">
      <option value="standard" ${S.waveType === 'standard' ? 'selected' : ''}>Standard wave</option>
    </select>
    <button class="wb g" onclick="__wpA.generateWavePlan()">⚙ Generate Wave Plan</button>
    ${seq ? `<button class="wb" style="border-color:#D4A017;color:#D4A017" onclick="__wpA.publishWavePlan()">📢 Publish${S.discordWebhook ? ' + Discord' : ''}</button>` : ''}
    ${isDraft ? `<button class="wb r" onclick="__wpA.discardWaveDraft()">✕ Discard draft</button>` : ''}
    ${S.waveGenAt ? `<span style="font-size:15px;color:#617070">generated ${new Date(S.waveGenAt).toLocaleTimeString()} — send times were measured then</span>` : ''}
  </div>`;

  if (!flaggedCount) {
    return h + `<div class="watk-notarget">// No wave targets flagged<br>
      <span style="font-size:17px">Set waves on the WAR BOARD tab first, then generate.</span></div>`;
  }

  // Warnings
  const warn = [];
  if (strayProvs.length)
    warn.push(`⚠ <b>Stray armies:</b> ${esc(strayProvs.join(', '))} — returns >1h apart, full offense never home at once. Consider telling them to hold the stray.`);
  if (S._waveGen?.uncovered?.length)
    warn.push(`⚠ <b>Uncovered targets:</b> ${esc(S._waveGen.uncovered.join(', '))} — no slot could break them in range.`);
  if (S._waveGen?.idleSlots?.length)
    warn.push(`⚠ <b>Idle slots:</b> ${S._waveGen.idleSlots.length} attacker slot(s) got no assignment.`);
  const marginalCount = seq ? seq.filter(x => x.marginal || x.risky).length : 0;
  if (marginalCount)
    warn.push(`⚠ <b>${marginalCount} marginal/risky hit${marginalCount > 1 ? 's' : ''}</b> — out of range or may not break; review below.`);
  if (S._waveGen?.ambushHolds?.length)
    warn.push(`🛡 <b>Ambush gens held:</b> ${S._waveGen.ambushHolds.map(a =>
      `${esc(a.attacker)} (${fK(a.leftover)} off stays home)`).join(', ')} — 1 spare general kept back since substantial offense remains home.`);
  const popWarnCount = seq ? seq.filter(x => x.popWarn).length : 0;
  if (popWarnCount)
    warn.push(`🏠 <b>${popWarnCount} hit${popWarnCount > 1 ? 's' : ''} against pop% strategy</b> — attacker pop suggests a different attack type (marked in the table).`);
  const dumpCount = seq ? seq.filter(x => x.dump).length : 0;
  if (dumpCount)
    warn.push(`♻ <b>${dumpCount} dump hit${dumpCount > 1 ? 's' : ''}</b> — leftover offense spent on small/out-of-range enemies rather than staying home.`);
  for (const cs of (S._waveGen?.chainStatus || [])) {
    warn.push(cs.done
      ? `<span style="color:#60C040">⛓ <b>Chain goal reached:</b> ${esc(cs.name)} ${cs.from} → ~${cs.to} acres (goal ${cs.goal})</span>`
      : `⛓ <b>Chain incomplete:</b> ${esc(cs.name)} only planned down to ~${cs.to} acres (goal ${cs.goal}, from ${cs.from}) — not enough breakable offense in range.`);
  }
  if (warn.length) {
    h += `<div style="margin-bottom:12px;padding:8px 14px;background:#201808;border:1px solid #805020;
      border-radius:3px;font-size:17px;color:#e09040;display:grid;gap:4px">${warn.map(w => `<div>${w}</div>`).join('')}</div>`;
  }

  if (!seq) {
    return h + `<div class="watk-notarget">// Ready — ${slots.length} attack slots, ${flaggedCount} flagged targets<br>
      <span style="font-size:17px">Hit ⚙ Generate Wave Plan to build the sequence.</span></div>`;
  }

  // Reassign dropdown options (shared)
  const slotOpts = slots.map(s =>
    `<option value="${s.key}">${esc(s.attacker)}${s.stray ? ' ('+_wpFmtTime(s.availableAt)+')' : ''} · ${fK(s.off)} off</option>`).join('');

  // Sequence table
  const thStyle = 'text-align:left;padding:5px 8px;font-size:15px;font-weight:700;color:#7a9090;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #617070';
  h += `<div class="wsech">// WAVE SEQUENCE — hits in send order</div>
    <table style="width:100%;border-collapse:collapse;font-size:17px">
    <thead><tr>
      <th style="${thStyle}">#</th><th style="${thStyle}">Send</th>
      <th style="${thStyle}">Attacker</th><th style="${thStyle}">Target</th>
      <th style="${thStyle}">Range</th><th style="${thStyle}">Type</th>
      <th style="${thStyle}">Gens</th><th style="${thStyle}">Off Sent</th>
      <th style="${thStyle}">Proj. NW</th><th style="${thStyle}">Est Gain</th>
      <th style="${thStyle}"></th>
    </tr></thead><tbody>`;

  for (const hit of seq) {
    const typeBadge = hit.type === 'RAZE' ? '<span class="watk-type watk-type-rz">Raze</span>'
                    : hit.type === 'MASS' ? '<span class="watk-type watk-type-ms">Mass</span>'
                    : '<span class="watk-type watk-type-tm">TM</span>';
    const chainGoal = S.provinces[hit.targetSlot]?.targetAcres || 0;
    const flags = (chainGoal    ? ` <span style="color:#E05050;font-size:15px" title="Chain target — goal ${fK(chainGoal)} acres">⛓${hit.projLand != null ? ' ' + fK(hit.projLand) + '→' : ''}</span>` : '')
                + (hit.marginal ? ' <span style="color:#e09040;font-weight:700">⚠ marginal</span>' : '')
                + (hit.risky    ? ' <span style="color:#E05050;font-weight:700">⚠ risky</span>'    : '')
                + (hit.isWall   ? ' <span style="color:#9060c0;font-size:15px">wall</span>'         : '')
                + (hit.dump     ? ' <span style="color:#617070;font-size:15px" title="Leftover offense spent — low value, but nothing stays home">♻ dump</span>' : '')
                + (hit.popWarn  ? ` <span style="color:#e09040;font-size:15px" title="${esc(hit.popWarn)}">🏠 ${esc(hit.popWarn)}</span>` : '');
    h += `<tr style="border-bottom:1px solid #617070${hit.marginal || hit.risky ? ';background:rgba(224,144,64,.06)' : ''}">
      <td style="padding:6px 8px;color:#7a9090;font-family:monospace">${hit.n}</td>
      <td style="padding:6px 8px;font-family:monospace">${_wpFmtTime(hit.availableAt)}</td>
      <td style="padding:6px 8px;font-weight:600">${esc(hit.attacker)}</td>
      <td style="padding:6px 8px">${esc(hit.target)}${flags}</td>
      <td style="padding:6px 8px">${_wpRangeBadge(hit.range)}</td>
      <td style="padding:6px 8px">${typeBadge}</td>
      <td style="padding:6px 8px;font-family:monospace">${hit.gens}</td>
      <td style="padding:6px 8px;font-family:monospace">${fK(hit.sentOff)}</td>
      <td style="padding:6px 8px;font-family:monospace;color:#7a9090">${fK(hit.projNW)}</td>
      <td style="padding:6px 8px;font-family:monospace;color:#80a8f0">${hit.estGain ? '~' + fK(hit.estGain) : '—'}</td>
      <td style="padding:6px 8px;white-space:nowrap">
        <select onchange="__wpA.wpReassign(${hit.n}, this.value)" title="Reassign this hit to another attacker slot"
          style="background:#1a2828;border:1px solid #617070;color:#b8c8c8;font-size:14px;padding:2px 4px;border-radius:3px;max-width:150px">
          <option value="">↷ reassign…</option>${slotOpts}
        </select>
        <span onclick="__wpA.wpRemoveHit(${hit.n})" title="Remove this hit"
          style="cursor:pointer;color:#E05050;font-weight:700;padding:0 4px">✕</span>
      </td>
    </tr>`;
  }
  h += `</tbody></table>
    <div style="margin-top:10px;font-size:15px;color:#617070">
      Send times are army-return offsets measured at generation. Proj. NW = simulated target NW at that
      point in the sequence (earlier hits shrink targets). Off Sent = raw troops after the +5%/extra-gen
      bonus — spare generals are spread across the province's hits to cut losses (one may be held for
      ambush when substantial offense stays home). Reassigning or removing hits re-simulates everything.
    </div>`;
  return h;
}
