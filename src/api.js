// ── API ────────────────────────────────────────────────────────────────────
// All calls to api.intel.utopia.site live here.
// Functions are async and return parsed data or throw on failure.
// This is the only place that knows about BASE and H — add new endpoints here.

function _headers() {
  return { 'Utopia-Token': S.token, 'Content-Type': 'application/json' };
}

function _url(path) {
  return `${CFG.API_BASE}${path}`;
}

/** Fetch own kingdom data (SoT, SoM, SoS, Survey per province) */
async function fetchOwnKingdom() {
  const r = await fetch(_url(`/Kingdom/v1/OwnKingdom?server=${S.server}`), { headers: _headers() });
  if (!r.ok) throw new Error(`API ${r.status} — token may be expired. Reload the IS via game link.`);
  return r.json();
}

/** Fetch enemy kingdom data */
async function fetchEnemyKingdom(location) {
  const r = await fetch(_url(`/Kingdom/v1/EnemyKingdom?server=${S.server}&location=${location}`), { headers: _headers() })
    .catch(() => null);
  if (!r || !r.ok) return null;
  return r.json();
}

/** Fetch all op logs for the own kingdom (~24h window) */
async function fetchKingdomOps() {
  const r = await fetch(_url(`/Kingdom/v1/KingdomOps?server=${S.server}`), { headers: _headers() })
    .catch(() => null);
  if (!r || !r.ok) return null;
  return r.json();
}

/**
 * Create or update a war plan.
 * Pass an empty body {} to just get/create the warPlanId.
 * Pass {json, warPlanId} to save content.
 */
async function postWarPlan(location, body) {
  const r = await fetch(_url(`/WarPlan/v1/Post?server=${S.server}&location=${location}`), {
    method: 'POST',
    headers: _headers(),
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) return null;
  return r.json();
}

/** Load a saved war plan by ID */
async function getWarPlan(location, warPlanId) {
  const r = await fetch(_url(`/WarPlan/v1/Get?server=${S.server}&location=${location}&warPlanId=${warPlanId}`), {
    headers: _headers(),
  });
  if (!r.ok) return null;
  return r.json();
}
