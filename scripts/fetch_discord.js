#!/usr/bin/env node
// Fetches all messages from a Discord channel and saves as ops.txt
// Usage: DISCORD_TOKEN=xxx DISCORD_CHANNEL_ID=xxx node scripts/fetch_discord.js
//   (PowerShell: $env:DISCORD_TOKEN='xxx'; $env:DISCORD_CHANNEL_ID='xxx'; node scripts/fetch_discord.js)
// Never hardcode the token here — it grants full account access if leaked.

const https      = require('https');
const fs         = require('fs');
const path       = require('path');

const TOKEN      = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const OUT_FILE   = path.join(__dirname, '..', 'ops.txt');

if (!TOKEN || !CHANNEL_ID) {
  console.error('Set DISCORD_TOKEN and DISCORD_CHANNEL_ID environment variables first.');
  process.exit(1);
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: { Authorization: TOKEN, 'User-Agent': 'Mozilla/5.0' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const messages = [];
  let before     = null;
  let page       = 0;

  console.log('Fetching messages...');

  while (true) {
    const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=100`
              + (before ? `&before=${before}` : '');

    const { status, body } = await get(url);

    if (status === 429) {
      const retry = JSON.parse(body).retry_after || 1;
      console.log(`  Rate limited — waiting ${retry}s`);
      await sleep(retry * 1000 + 200);
      continue;
    }

    if (status !== 200) {
      console.error(`API error ${status}: ${body}`);
      break;
    }

    const batch = JSON.parse(body);
    if (!batch.length) break;

    messages.push(...batch);
    before = batch[batch.length - 1].id;
    page++;
    process.stdout.write(`\r  Page ${page} — ${messages.length} messages fetched`);

    await sleep(300); // stay well under rate limit
  }

  console.log(`\nTotal: ${messages.length} messages`);

  // Write plain text — newest first from API, reverse to chronological
  messages.reverse();
  const lines = messages.map(m => {
    const author = m.author?.username || '?';
    const ts     = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
    if (m.content) return `[${ts}] ${author}: ${m.content}`;
    // Embeds (utopiabot posts op results as embeds)
    if (m.embeds?.length) {
      return m.embeds.map(e => {
        const parts = [e.title, e.description, ...(e.fields||[]).map(f => `${f.name}: ${f.value}`)].filter(Boolean);
        return `[${ts}] ${author}: ${parts.join(' | ')}`;
      }).join('\n');
    }
    return null;
  }).filter(Boolean);

  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log(`Saved to ops.txt (${lines.length} lines)`);
}

main().catch(console.error);
