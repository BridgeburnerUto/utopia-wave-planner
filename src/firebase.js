// ── FIREBASE ───────────────────────────────────────────────────────────────
// Firestore REST API helpers. No SDK required — plain fetch.
// All functions return parsed JS objects, not raw Firestore field maps.

/** Convert a plain JS value to a Firestore field value */
function _toFB(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (v instanceof Set)       return { arrayValue: { values: [...v].map(_toFB) } };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(_toFB) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, _toFB(val)])) } };
  return { stringValue: String(v) };
}

/** Convert a Firestore field value back to a plain JS value */
function _fromFB(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(_fromFB);
  if ('mapValue'     in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, _fromFB(val)]));
  return null;
}

function _fbUrl(path) {
  return `${CFG.FB_BASE}/${path}?key=${CFG.FB_API_KEY}`;
}

/** Write (PATCH/upsert) a document at path with plain JS data object */
async function fbWrite(path, data) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, _toFB(v)]));
  const r = await fetch(_fbUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }).catch(() => null);
  if (!r) return null;
  return r.json();
}

/** Read a single document at path, returns plain JS object or null */
async function fbGet(path) {
  const r = await fetch(_fbUrl(path)).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json();
}

/**
 * Query a collection with simple field filters.
 * filters: [{field, op, value}] — op defaults to 'EQUAL', value must be a string.
 * Returns array of plain JS objects (fields unwrapped from Firestore format).
 */
/** Delete a document at path */
async function fbDelete(path) {
  const r = await fetch(_fbUrl(path), { method: 'DELETE' }).catch(() => null);
  return r?.ok || false;
}

async function fbQuery(collection, filters = []) {
  const url = `${CFG.FB_BASE}:runQuery?key=${CFG.FB_API_KEY}`;
  const where = filters.map(f => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: f.op || 'EQUAL',
      value: { stringValue: f.value },
    },
  }));
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: filters.length === 1 ? where[0] : { compositeFilter: { op: 'AND', filters: where } },
      limit: 2000,
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r || !r.ok) return [];
  const data = await r.json();
  return (data || [])
    .filter(d => d.document)
    .map(d => Object.fromEntries(Object.entries(d.document.fields || {}).map(([k, v]) => [k, _fromFB(v)])));
}
