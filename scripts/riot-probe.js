#!/usr/bin/env node
/**
 * riot-probe.js — does the Discord op feed carry the DURATION of an Incite Riots?
 *
 * WHY THIS EXISTS: the IS KingdomOps endpoint gives us the op, the target, the
 * result and a timestamp — but no duration, and riot duration scales with the
 * thieves sent. tabs/economy.js therefore assumes RIOTS_TICKS_ASSUMED ticks for
 * every riot we incite on the enemy and marks the chip "est". The utopiabot ops
 * channel is the other record of the same op, and it posts op results as EMBEDS
 * (title / description / fields), which carry more text than the API does. If
 * the duration is anywhere, it is in there.
 *
 * This script answers that question against real messages instead of guessing a
 * parser. It does NOT write anything anywhere.
 *
 * USAGE
 *   From an existing dump (what scripts/fetch_discord.js writes):
 *     node scripts/riot-probe.js ops.txt
 *   Straight from the channel (nothing is saved):
 *     DISCORD_TOKEN=xxx DISCORD_CHANNEL_ID=xxx node scripts/riot-probe.js [--pages 5]
 *
 * A dump is the flattened text, so it can only tell us whether a duration
 * survives into it. Fetching gives the RAW message JSON, which also tells us
 * WHICH field holds it — that is what a collector would have to read. Prefer it.
 *
 * The token is read from the environment and never printed. Discord sits behind
 * Cloudflare, which rejects requests with no real User-Agent (this cost a
 * session once — see CONTEXT 2026-08-11, bug 2), so one is always sent.
 */

const https = require('https');
const fs    = require('fs');

const args    = process.argv.slice(2);
const pagesAt = args.indexOf('--pages');
const PAGES   = pagesAt >= 0 ? parseInt(args[pagesAt + 1] || '5', 10) : 5;
const FILE    = args.find(a => !a.startsWith('--') && a !== String(PAGES));

const TOKEN      = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// A riot line, however the bot words it. \b so PATRIOTISM cannot match (the
// same trap RIOTS_SOT_RE walked into in config.js).
const RIOT_RE = /\briot/i;
// Anything that could be a duration: "12 days", "12d", "12 ticks", "for 12".
const DUR_RE  = /(\d+)\s*(days?|ticks?|d\b|t\b)/gi;
// utopiabot's compact op line puts thieves sent as "N sent" — the input the
// real duration formula scales with, and the fallback if no duration is posted.
const SENT_RE = /([\d,]+)\s*sent/i;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: {
      Authorization: TOKEN,
      'User-Agent': 'DiscordBot (https://github.com/BridgeburnerUto/utopia-wave-planner, 1.0)',
    } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Every piece of text a message carries, labelled by where it came from. */
function messageParts(m) {
  const parts = [];
  if (m.content) parts.push({ where: 'content', text: m.content });
  for (const [i, e] of (m.embeds || []).entries()) {
    if (e.title)       parts.push({ where: `embed[${i}].title`,       text: e.title });
    if (e.description) parts.push({ where: `embed[${i}].description`, text: e.description });
    for (const f of (e.fields || [])) {
      if (f.name)  parts.push({ where: `embed[${i}].field.name`,  text: f.name });
      if (f.value) parts.push({ where: `embed[${i}].field:${f.name}`, text: f.value });
    }
    if (e.footer?.text) parts.push({ where: `embed[${i}].footer`, text: e.footer.text });
  }
  return parts;
}

async function fetchRiotMessages() {
  const out = [];
  let before = null;
  for (let page = 0; page < PAGES; page++) {
    const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=100`
              + (before ? `&before=${before}` : '');
    const { status, body } = await get(url);
    if (status === 429) {
      const retry = (JSON.parse(body).retry_after || 1) * 1000 + 200;
      console.log(`  rate limited — waiting ${Math.round(retry / 1000)}s`);
      await sleep(retry);
      page--;
      continue;
    }
    if (status !== 200) {
      console.error(`Discord API ${status}. ${status === 401 ? 'Token rejected.'
        : status === 403 ? 'Forbidden — for a BOT token check Message Content Intent (CONTEXT 2026-08-11, bug 3).'
        : body.slice(0, 200)}`);
      break;
    }
    const batch = JSON.parse(body);
    if (!batch.length) break;
    for (const m of batch) {
      if (messageParts(m).some(p => RIOT_RE.test(p.text))) out.push(m);
    }
    before = batch[batch.length - 1].id;
    process.stdout.write(`\r  page ${page + 1} — ${out.length} riot messages so far`);
    await sleep(300);
  }
  console.log('');
  return out;
}

/** Dump-file mode: the flattened text fetch_discord.js writes. */
function riotLinesFromFile(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => RIOT_RE.test(l));
}

function scan(text) {
  DUR_RE.lastIndex = 0;
  const durs = [...text.matchAll(DUR_RE)].map(m => m[0]);
  const sent = text.match(SENT_RE);
  return { durs, sent: sent ? sent[1] : null };
}

function report(samples) {
  // samples: [{ label, parts: [{where, text}] }]
  if (!samples.length) {
    console.log('\nNo Incite Riots messages found.');
    console.log('If we HAVE rioted recently, widen the search: this only matches /\\briot/i,');
    console.log('and the bot may word it differently (that is exactly the unknown here).');
    return;
  }

  console.log(`\n${samples.length} riot message(s) found. Raw text, verbatim:\n`);
  for (const s of samples.slice(0, 8)) {
    console.log('─'.repeat(72));
    console.log(s.label);
    for (const p of s.parts) console.log(`  ${p.where}: ${JSON.stringify(p.text)}`);
  }
  console.log('─'.repeat(72));

  let withDur = 0, withSent = 0;
  const shapes = new Map();   // "where → the duration-looking text" → count
  for (const s of samples) {
    let d = false, n = false;
    for (const p of s.parts) {
      const r = scan(p.text);
      if (r.durs.length) {
        d = true;
        for (const hit of r.durs) {
          const k = `${p.where} → ${hit}`;
          shapes.set(k, (shapes.get(k) || 0) + 1);
        }
      }
      if (r.sent) n = true;
    }
    if (d) withDur++;
    if (n) withSent++;
  }

  console.log(`\nVERDICT over ${samples.length} riot message(s):`);
  console.log(`  duration-looking number ("12 days" / "12t" / …): ${withDur}`);
  console.log(`  thieves-sent number ("N sent"):                  ${withSent}`);
  if (shapes.size) {
    console.log('\n  where the duration-looking numbers sat (top 15):');
    [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([k, n]) => console.log(`    ×${n}  ${k}`));
  }
  console.log(withDur
    ? '\n  → The feed carries it. A collector can read the exact duration per op\n'
      + '    (see scripts/oldis-collector.js for the pattern: parse, push one\n'
      + '    Firestore doc, let the client read it) and RIOTS_TICKS_ASSUMED\n'
      + '    becomes the fallback rather than the answer.'
    : '\n  → No duration in the feed. Then the only lead is the thieves-sent\n'
      + '    number above plus the game formula that turns it into days —\n'
      + '    without that formula the estimate stays an estimate.');
}

async function main() {
  if (FILE) {
    if (!fs.existsSync(FILE)) { console.error(`No such file: ${FILE}`); process.exit(1); }
    console.log(`Reading ${FILE} (flattened dump — tells us WHETHER, not WHERE)`);
    const lines = riotLinesFromFile(FILE);
    report(lines.map((l, i) => ({ label: `line ${i + 1}`, parts: [{ where: 'line', text: l }] })));
    return;
  }
  if (!TOKEN || !CHANNEL_ID) {
    console.error('Set DISCORD_TOKEN and DISCORD_CHANNEL_ID, or pass a dump file (ops.txt).');
    process.exit(1);
  }
  console.log(`Fetching up to ${PAGES} page(s) of the ops channel…`);
  const msgs = await fetchRiotMessages();
  report(msgs.map(m => ({
    label: `[${m.timestamp}] ${m.author?.username || '?'}`,
    parts: messageParts(m),
  })));
}

main().catch(e => { console.error(e.message); process.exit(1); });
