// ── RITUAL TIMER ───────────────────────────────────────────────────────────
// Handles ritual badge display in header, expand/collapse dropdown,
// expiry date calculation, and Snatch News alert tracking.

// ── Utopian date math ────────────────────────────────────────────────────────
// Calendar: 7 months (Jan-Jul), 24 days/month, 168 days/year
// 1 tick = 1 real hour = 1 in-game day

const MONTHS_LIST = [
  'January','February','March','April','May','June','July'
];

/** Convert {month, day, year} to absolute day number (1-based) */
function _utoToAbs(month, day, year) {
  return (year - 1) * 168 + (month - 1) * 24 + day;
}

/** Convert absolute day number back to {month, day, year, label} */
function _absToUto(abs) {
  const y = Math.floor((abs - 1) / 168) + 1;
  const rem = ((abs - 1) % 168);
  const m = Math.floor(rem / 24) + 1;
  const d = (rem % 24) + 1;
  return { year: y, month: m, day: d, label: `${MONTHS_LIST[m-1]} ${d}, YR${y}` };
}

/** Add ticks to current in-game date string "July 18, YR1" → expiry date label */
function _ritualExpiry(currentTickName, ticksRemaining) {
  if (!currentTickName || !ticksRemaining) return null;
  const d = _parseUtoDate(currentTickName);
  if (!d) return null;
  const abs = _utoToAbs(d.month, d.day, d.year) + ticksRemaining;
  return _absToUto(abs);
}

// ── Ritual badge colour ───────────────────────────────────────────────────────
function _ritualColor(ticks) {
  if (ticks == null) return '#4a6a88';
  if (ticks <= 24)   return '#ff4455';
  if (ticks <= 48)   return '#ffaa00';
  return '#00ff88';
}

// ── Parse ritual events from kingdomNews.parseString ────────────────────────────
// Works for both own news and SN (enemy news looks identical from their perspective)

function _parseRitualNews(parseString) {
  if (!parseString) return { developing: null, active: null, lifted: null };
  const result = { developing: null, active: null, lifted: null };
  const lines  = parseString.trim().split('\n');

  lines.forEach(line => {
    const parts = line.split('\t');
    if (parts.length < 2) return;
    const dateStr = parts[0].trim();
    const text    = parts[1].trim();
    const d       = _parseNewsDate(dateStr);
    if (!d) return;

    if (/started developing a ritual/i.test(text)) {
      const nm = text.match(/\(([^)]+)\)/);
      // Keep the most recent (last in array = latest in news feed)
      result.developing = { date: d, name: nm ? nm[1] : 'Unknown', dateLabel: dateStr };
    } else if (/ritual is covering/i.test(text)) {
      const nm = text.match(/\(([^)]+)\)/);
      result.active = { date: d, name: nm ? nm[1] : 'Unknown', dateLabel: dateStr };
    } else if (/ritual covering.*lifted/i.test(text)) {
      result.lifted = { date: d, dateLabel: dateStr };
    }
  });

  return result;
}

/** Parse "July 2 of YR1" → {month, day, year} */
function _parseNewsDate(s) {
  const m = s.match(/(\w+)\s+(\d+)\s+of\s+YR(\d+)/i);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return { month, day: parseInt(m[2]), year: parseInt(m[3]) };
}

/**
 * Check kingdomNews for enemy ritual development status.
 * Returns null if nothing relevant, or an object with casting info.
 */
function getEnemyRitualCasting() {
  try {
    const IS      = JSON.parse(localStorage.getItem('IntelState') || '{}');
    const news    = IS.kingdomNews?.parseString;
    if (!news) return null;

    const parsed  = _parseRitualNews(news);

    // If no developing entry found → nothing to show
    if (!parsed.developing) return null;

    const dev = parsed.developing;

    // If we have a later "active" entry → ritual already launched, no countdown needed
    if (parsed.active) {
      const devAbs = _utoToAbs(dev.date.month, dev.date.day, dev.date.year);
      const actAbs = _utoToAbs(parsed.active.date.month, parsed.active.date.day, parsed.active.date.year);
      if (actAbs >= devAbs) return null; // launched already
    }

    // If we have a later "lifted" entry after developing → cycle is done
    if (parsed.lifted) {
      const devAbs    = _utoToAbs(dev.date.month, dev.date.day, dev.date.year);
      const liftedAbs = _utoToAbs(parsed.lifted.date.month, parsed.lifted.date.day, parsed.lifted.date.year);
      if (liftedAbs >= devAbs) return null;
    }

    // Ritual is still being cast — calculate auto-launch deadline
    // Auto-launch = start date + 48 ticks
    const startAbs   = _utoToAbs(dev.date.month, dev.date.day, dev.date.year);
    const launchAbs  = startAbs + 48;
    const launchDate = _absToUto(launchAbs);

    // How many ticks until auto-launch? Use current tick date
    let ticksUntilLaunch = null;
    if (S.currentTickName) {
      const cur = _parseUtoDate(S.currentTickName);
      if (cur) {
        const curAbs = _utoToAbs(cur.month, cur.day, cur.year);
        ticksUntilLaunch = launchAbs - curAbs;
      }
    }

    return {
      name:              dev.name,
      startLabel:        dev.dateLabel,
      launchLabel:       launchDate.label,
      ticksUntilLaunch,  // null if we can't calculate, negative if overdue
    };
  } catch(e) {
    return null;
  }
}

// ── Render ritual badges in header ───────────────────────────────────────────
function renderRitualBadges() {
  const own   = S.own?.kdEffects;
  const enemy = S.enemy?.kdEffects;
  const tick  = S.currentTickName;

  let html = '';

  // Own ritual badge
  if (own?.ritual) {
    const col    = _ritualColor(own.ritualDuration);
    const expiry = _ritualExpiry(tick, own.ritualDuration);
    html += `
      <div class="wkb writ-badge" id="__wprit_own" onclick="__wpA.toggleRitual('own')" style="cursor:pointer;border-color:${col}22">
        <div class="l">Own Ritual</div>
        <div class="v" style="color:${col};font-family:monospace">${own.ritualDuration}t</div>
      <div class="writ-drop" id="__wprit_own_drop" style="display:none">
        <div class="writ-drop-title">${esc(own.ritual)}</div>
        <div class="writ-drop-row"><span class="writ-drop-l">Ticks left</span><span style="color:${col};font-family:monospace">${own.ritualDuration}</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Real hours</span><span style="font-family:monospace">${own.ritualDuration}h</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Effectiveness</span><span style="font-family:monospace;color:#00d4ff">${own.ritualEff?.toFixed(1)}%</span></div>
        ${expiry ? `<div class="writ-drop-row"><span class="writ-drop-l">Expires</span><span style="font-family:monospace;color:#ffaa00">${esc(expiry.label)}</span></div>` : ''}
      </div></div>`;
  }

  // Enemy ritual badge — active ritual OR casting in progress
  const casting = getEnemyRitualCasting();

  if (enemy?.ritual) {
    const col    = _ritualColor(enemy.ritualDuration);
    const expiry = _ritualExpiry(tick, enemy.ritualDuration);
    // Casting info shown inside dropdown even if ritual is already active
    const castingHtml = casting ? `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #1e2d3d">
        <div style="font-family:monospace;font-size:10px;color:#ffaa00;letter-spacing:1px;margin-bottom:6px">⚠ NEXT RITUAL CASTING</div>
        <div class="writ-drop-row"><span class="writ-drop-l">Ritual</span><span style="font-family:monospace">${esc(casting.name)}</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Started</span><span style="font-family:monospace">${esc(casting.startLabel)}</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Auto-launch</span><span style="font-family:monospace;color:#ffaa00">${esc(casting.launchLabel)}</span></div>
        ${casting.ticksUntilLaunch != null ? `<div class="writ-drop-row"><span class="writ-drop-l">Time left</span><span style="font-family:monospace;color:${casting.ticksUntilLaunch <= 0 ? '#ff4455' : casting.ticksUntilLaunch <= 12 ? '#ffaa00' : '#c8d8e8'}">${casting.ticksUntilLaunch <= 0 ? 'OVERDUE — check if launched' : casting.ticksUntilLaunch + 't (' + casting.ticksUntilLaunch + 'h)'}</span></div>` : ''}
      </div>` : '';
    html += `
      <div class="wkb writ-badge" id="__wprit_ene" onclick="__wpA.toggleRitual('ene')" style="cursor:pointer;border-color:${col}22">
        <div class="l">Enemy Ritual</div>
        <div class="v" style="color:${col};font-family:monospace">${enemy.ritualDuration}t</div>
      <div class="writ-drop" id="__wprit_ene_drop" style="display:none">
        <div class="writ-drop-title">${esc(enemy.ritual)}</div>
        <div class="writ-drop-row"><span class="writ-drop-l">Ticks left</span><span style="color:${col};font-family:monospace">${enemy.ritualDuration}</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Real hours</span><span style="font-family:monospace">${enemy.ritualDuration}h</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Effectiveness</span><span style="font-family:monospace;color:#00d4ff">${enemy.ritualEff?.toFixed(1)}%</span></div>
        ${expiry ? `<div class="writ-drop-row"><span class="writ-drop-l">Expires</span><span style="font-family:monospace;color:#ffaa00">${esc(expiry.label)}</span></div>` : ''}
        ${castingHtml}
      </div></div>`;
  } else if (casting) {
    // No active ritual but casting detected — show amber badge
    const timeCol = casting.ticksUntilLaunch != null && casting.ticksUntilLaunch <= 12 ? '#ff4455' : '#ffaa00';
    const timeStr = casting.ticksUntilLaunch != null
      ? (casting.ticksUntilLaunch <= 0 ? 'OVERDUE' : casting.ticksUntilLaunch + 't')
      : '?';
    html += `
      <div class="wkb writ-badge" id="__wprit_ene" onclick="__wpA.toggleRitual('ene')" style="cursor:pointer;border-color:#ffaa0022">
        <div class="l">Enemy Casting</div>
        <div class="v" style="color:${timeCol};font-family:monospace">⚠ ${timeStr}</div>
      <div class="writ-drop" id="__wprit_ene_drop" style="display:none">
        <div class="writ-drop-title" style="color:#ffaa00">⚠ Ritual Being Cast</div>
        <div class="writ-drop-row"><span class="writ-drop-l">Ritual</span><span style="font-family:monospace">${esc(casting.name)}</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Started</span><span style="font-family:monospace">${esc(casting.startLabel)}</span></div>
        <div class="writ-drop-row"><span class="writ-drop-l">Auto-launch</span><span style="font-family:monospace;color:#ffaa00">${esc(casting.launchLabel)}</span></div>
        ${casting.ticksUntilLaunch != null ? `<div class="writ-drop-row"><span class="writ-drop-l">Time left</span><span style="font-family:monospace;color:${timeCol}">${casting.ticksUntilLaunch <= 0 ? 'OVERDUE — check if launched' : casting.ticksUntilLaunch + 't (' + casting.ticksUntilLaunch + 'h)'}</span></div>` : ''}
        <div style="margin-top:8px;font-size:10px;color:#4a6a88">Source: Snatch News. Take another SN to confirm if it has launched.</div>
      </div></div>`;
  }

  const container = $id('__wprit');
  if (container) container.innerHTML = html;
}

/** Toggle ritual dropdown open/closed */
function toggleRitual(which) {
  const drop = $id(`__wprit_${which}_drop`);
  if (!drop) return;
  const isOpen = drop.style.display !== 'none';
  // Close all dropdowns first
  ['own','ene'].forEach(w => {
    const d = $id(`__wprit_${w}_drop`);
    if (d) d.style.display = 'none';
  });
  if (!isOpen) drop.style.display = 'block';
}

// ── Snatch News alert ────────────────────────────────────────────────────────
// Stored in Firebase: meta/{kdId}_sn_ack — {ackedAt: timestamp}
// Alert fires if more than 24h since last ack

async function snAck() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return;
  await fbWrite(`meta/${kdId}_sn_ack`, { ackedAt: Date.now(), ackedBy: S.own?.kingdomName || '' });
  renderAlerts(); // refresh alerts to clear the SN alert
}

async function getSnLastAck() {
  const kdId = S.own?.location.replace(':', '_');
  if (!kdId) return 0;
  try {
    const doc = await fbGet(`meta/${kdId}_sn_ack`);
    if (doc?.fields?.ackedAt) return parseInt(doc.fields.ackedAt.integerValue || 0);
  } catch(e) {}
  return 0;
}

// Expose SN last-ack time on S so alerts can check it synchronously
// Updated once on init and after each ack
async function loadSnAck() {
  S.snLastAck = await getSnLastAck();
}
