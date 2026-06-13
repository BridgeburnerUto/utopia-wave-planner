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
      </div>
      <button class="wb" style="margin-top:10px" onclick="__wpA.aiStrategySendToDiscord()">Send to Discord</button>`;
  }

  const disabled = (S.aiStrategyResult && S.aiStrategyResult.loading) ? 'disabled style="opacity:.5;cursor:not-allowed"' : '';

  // History — last few results, newest first
  const hist = S.aiStrategyHistory || [];
  let histHtml = '';
  if (hist.length) {
    histHtml = `<div class="wthr-title" style="margin-top:16px">History</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${hist.map((h, i) => {
          const active = (r && !r.loading && !r.error && r.generated_at === h.generated_at);
          return `<button class="wb" style="text-align:left;${active ? 'border:1px solid #5fcf9f;' : ''}" onclick="__wpA.aiStrategyShowHistory(${i})">
            vs ${esc(h.eLoc || '?')} — ${esc(h.generated_at || '')}
          </button>`;
        }).join('')}
      </div>`;
  }

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
    ${histHtml}
  </div>`;
}

const AI_STRATEGY_HISTORY_MAX = 5;

function aiStrategyShowHistory(i) {
  const h = (S.aiStrategyHistory || [])[i];
  if (!h) return;
  S.aiStrategyResult = h;
  renderAiStrategy();
}

async function aiStrategySendToDiscord() {
  const r = S.aiStrategyResult;
  if (!r || r.loading || r.error || !r.analysis) return;
  if (!S.discordWebhook) {
    alert('No Discord webhook configured — set it in the Alerts tab first.');
    return;
  }
  const ok = await sendDiscordEmbed(S.discordWebhook, {
    content: '',
    embeds: [{
      title: `🧠 AI Strategy — vs ${S.eLoc || '?'}`,
      description: (r.analysis || '').slice(0, 4000),
      color: 4886754,
      timestamp: new Date().toISOString(),
      footer: { text: `Generated ${r.generated_at || ''}${r.calls_today ? ` · ${r.calls_today}/${r.daily_limit} calls today` : ''}` },
    }],
  });
  if (!ok) alert('Failed to send to Discord — check the webhook URL.');
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
      data.eLoc = S.eLoc;
      S.aiStrategyResult = data;
      S.aiStrategyHistory = [data, ...(S.aiStrategyHistory || [])].slice(0, AI_STRATEGY_HISTORY_MAX);
    }
  } catch (e) {
    S.aiStrategyResult = { error: e.message || String(e) };
  }
  renderAiStrategy();
}
