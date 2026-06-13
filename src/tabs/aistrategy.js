// ── TAB: AI STRATEGY ─────────────────────────────────────────────────────────

function renderAiStrategy() {
  renderTab('__wpc_aistrategy', _buildAiStrategy);
}

function _buildAiStrategy() {
  const r = S.aiStrategyResult;
  let resultHtml;
  if (!r) {
    resultHtml = 'No analysis run yet.';
  } else if (r.loading) {
    resultHtml = `<div class="wload"><div class="wspin"></div><div>Asking Claude for a strategy analysis…</div></div>`;
  } else if (r.error) {
    resultHtml = `<div class="walt wau"><div class="wabg">ERROR</div><div>${esc(r.error)}</div></div>`;
  } else {
    resultHtml = `<div style="white-space:pre-wrap;line-height:1.6;font-size:17px;color:#b8c8c8;">${esc(r.analysis || '')}</div>
      <div style="margin-top:10px;font-size:13px;color:#7a9090;">
        Generated ${esc(r.generated_at || '')}${r.calls_today ? ` · ${r.calls_today}/${r.daily_limit} calls today` : ''}
      </div>`;
  }

  const disabled = (S.aiStrategyResult && S.aiStrategyResult.loading) ? 'disabled style="opacity:.5;cursor:not-allowed"' : '';

  return `<div class="wsech">
    <div class="wthr-title">AI Strategy (beta)</div>
    <div style="font-size:17px;color:#7a9090;line-height:1.6;margin-bottom:12px;">
      Sends your current kingdom + enemy intel, recent kingdom news, and our
      strategy reference doc to Claude, and asks it to identify threats, chain
      targets, bloat targets, and recommended ops.
    </div>
    <button class="wb" ${disabled} onclick="__wpA.aiStrategyAnalyze()">Analyze</button>
    <div class="wthr-title" style="margin-top:16px">Analysis Results</div>
    <div style="min-height:60px;">
      ${resultHtml}
    </div>
  </div>`;
}

/**
 * Gathers current own/enemy intel + kingdom news, POSTs to the Cloud Run
 * ai_strategy.php endpoint, and renders the returned analysis.
 */
async function aiStrategyAnalyze() {
  if (!S.apiEndpoint) {
    S.aiStrategyResult = { error: 'No backend configured — set the Cloud Run API URL in the Alerts tab first.' };
    renderAiStrategy();
    return;
  }
  if (!S.own || !S.enemy) {
    S.aiStrategyResult = { error: 'Load both your kingdom and an enemy kingdom before running an analysis.' };
    renderAiStrategy();
    return;
  }

  S.aiStrategyResult = { loading: true };
  renderAiStrategy();

  try {
    _ensureKdNewsLoaded();
    const news = _buildNewsStats();

    const payload = {
      kdId: S.own.location,
      eLoc: S.eLoc,
      own:   { location: S.own.location,   provinces: S.own.provinces   || [] },
      enemy: { location: S.eLoc,           provinces: S.enemy.provinces || [] },
      news,
    };

    const url = S.apiEndpoint.replace(/\/$/, '') + '/ai_strategy.php';
    const hdrs = { 'Content-Type': 'application/json' };
    if (S.apiKey) hdrs['X-WP-Key'] = S.apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      S.aiStrategyResult = { error: (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) || `HTTP ${res.status}` };
    } else {
      S.aiStrategyResult = data;
    }
  } catch (e) {
    S.aiStrategyResult = { error: e.message || String(e) };
  }
  renderAiStrategy();
}
