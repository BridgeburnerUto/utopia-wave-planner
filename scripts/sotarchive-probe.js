// SotArchive probe — can the IS tell us when OUR OWN provinces were active?
//
// The IS keeps "SoTs over last 72 ticks" per province (Province/v1/SotArchive,
// found in the IS bundle 2026-09-11). An own province's SoT reaches the IS when
// its player loads a game page that forwards intel, so if the archive only
// holds (or only changes on) ticks where a fresh SoT arrived, it is an hourly
// activity log for the whole kingdom, 72 ticks back, with no collector at all.
// This probe finds out which it is.
//
// HOW TO RUN: open the Intel Site from the in-game link as usual, open the
// browser console (F12) on intel.utopia.site, paste this whole file, press
// Enter. It only READS (GET) from the IS, prints a summary and copies it to the
// clipboard. No token is printed and nothing is sent anywhere else.

(async () => {
  const API = 'https://api.intel.utopia.site';
  const token = sessionStorage.getItem('Utopia-Token');
  const server = parseInt(JSON.parse(localStorage.getItem('IntelState') || '{}').server || '1', 10);
  if (!token) return console.error('No Utopia-Token in this tab — open the Intel Site from the in-game link first.');
  const H = { 'Utopia-Token': token, 'Content-Type': 'application/json' };
  const get = async (path) => {
    const r = await fetch(API + path, { headers: H });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  };

  const ok = await get(`/Kingdom/v1/OwnKingdom?server=${server}`);
  const kd = ok.body?.kingdom || ok.body;
  if (!kd?.provinces) return console.error('OwnKingdom failed', ok.status);
  const tickNow = ok.body?.currentTick?.tickId ?? ok.body?.currentTick ?? null;

  // Pick provinces with very different intel ages: freshest, stalest, and two between
  const provs = [...kd.provinces].filter(p => p.sot).sort((a, b) => a.sot.ageSeconds - b.sot.ageSeconds);
  const pick = [...new Set([0, 1, Math.floor(provs.length / 2), provs.length - 1].map(i => provs[i]))].filter(Boolean);

  const out = { location: kd.location, server, tickNow, provinces: [] };
  for (const p of pick) {
    const r = await get(`/Province/v1/SotArchive?server=${server}&location=${kd.location}&slot=${p.slot}`);
    const raw = r.body;
    const arr = Array.isArray(raw) ? raw : (raw?.content || raw?.sots || raw?.archive || null);
    const info = {
      slot: p.slot, name: p.name, sotAgeH: +(p.sot.ageSeconds / 3600).toFixed(1), sotTickId: p.sot.tickId ?? null,
      status: r.status, shape: Array.isArray(raw) ? 'array' : (raw && typeof raw === 'object' ? 'object: ' + Object.keys(raw).join(',') : typeof raw),
    };
    if (Array.isArray(arr)) {
      const nn = arr.filter(Boolean);
      info.length = arr.length;
      info.nulls = arr.length - nn.length;
      info.entryKeys = nn[0] ? Object.keys(nn[0]) : [];
      info.tickIds = nn.map(e => e.tickId);
      info.tickNames = [nn[0]?.tickName, nn[nn.length - 1]?.tickName];
      // Does a tick's entry differ from the previous one? Money grows every tick
      // for anyone, so an IDENTICAL entry means "no new SoT that tick".
      const sig = e => JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'tickId' && k !== 'tickName')));
      const changedAt = [];
      let same = 0;
      nn.forEach((e, i) => { if (i && sig(e) === sig(nn[i - 1])) same++; else changedAt.push(e.tickId); });
      info.identicalToPrevious = same;
      info.changedAtTicks = changedAt;
      // Spacing of tickIds: consecutive (one per tick) or gappy (only ticks with a SoT)?
      const gaps = nn.slice(1).map((e, i) => e.tickId - nn[i].tickId);
      info.tickGaps = [...new Set(gaps)].sort((a, b) => a - b).slice(0, 12);
      info.sample = nn.slice(-2);
    }
    out.provinces.push(info);
  }
  const txt = JSON.stringify(out, null, 1);
  console.log(txt);
  try { copy(txt); console.log('↑ copied to clipboard — paste it back to Claude'); } catch (e) { console.log('↑ copy this and paste it back to Claude'); }
})();
