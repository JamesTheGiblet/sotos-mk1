#!/usr/bin/env node
/**
 * forge-monitor.js
 * Watches active_strategy.json and monitors for entry/exit conditions.
 * Dry run only — logs what it would do, no real trades.
 *
 * Usage:
 *   node forge-monitor.js              (checks every 5 minutes)
 *   node forge-monitor.js --once       (single check then exit)
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const ACTIVE_STRATEGY  = path.join(__dirname, 'reasoning-bot/active_strategy.json');
const MONITOR_LOG      = path.join(__dirname, 'reasoning-bot/data/monitor_log.json');
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── Kraken live price ──────────────────────────────────────────────────────────

function fetchLivePrices(pairs = ['XBTUSD']) {
  return new Promise((resolve, reject) => {
    const url = `https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`;
    https.get(url, { headers: { 'User-Agent': 'Forge/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error && json.error.length) return reject(new Error(json.error[0]));
          const result = {};
          for (const [key, val] of Object.entries(json.result || {})) {
            result[key] = {
              price:  parseFloat(val.c[0]),
              high:   parseFloat(val.h[1]),
              low:    parseFloat(val.l[1]),
              open:   parseFloat(val.o),
              volume: parseFloat(val.v[1])
            };
          }
          resolve(result);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function fetchOHLC(pair = 'XBTUSD', interval = 1440, limit = 100) {
  return new Promise((resolve, reject) => {
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
    https.get(url, { headers: { 'User-Agent': 'Forge/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error && json.error.length) return reject(new Error(json.error[0]));
          const key  = Object.keys(json.result).find(k => k !== 'last');
          const rows = (json.result[key] || []).slice(-limit);
          resolve(rows.map(r => ({
            timestamp: parseInt(r[0]),
            open:      parseFloat(r[1]),
            high:      parseFloat(r[2]),
            low:       parseFloat(r[3]),
            close:     parseFloat(r[4]),
            volume:    parseFloat(r[6])
          })));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Indicators ─────────────────────────────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

function calcMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1];
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcBollinger(closes, period = 20) {
  if (closes.length < period) return { upper: null, middle: null, lower: null };
  const w   = closes.slice(-period);
  const mid = w.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(w.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period);
  return { upper: mid + 2 * std, middle: mid, lower: mid - 2 * std };
}

function calcConsecRed(candles) {
  let count = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].close < candles[i].open) count++;
    else break;
  }
  return count;
}

// ── Rule evaluator ─────────────────────────────────────────────────────────────

function evaluateRule(rule, candles, currentPrice) {
  const rl     = rule.toLowerCase().trim();
  const closes = candles.map(c => c.close);

  if (rl.includes('consecutive red')) {
    const m = rl.match(/(\d+)\s+consecutive red/);
    return calcConsecRed(candles) >= (m ? parseInt(m[1]) : 3);
  }
  if (rl.includes('rsi')) {
    const pm = rl.match(/rsi\(?(\d+)\)?/);
    const rsi = calcRSI(closes, pm ? parseInt(pm[1]) : 14);
    if (rl.includes('<')) { const v = rl.match(/<\s*([\d.]+)/); return rsi < (v ? parseFloat(v[1]) : 30); }
    if (rl.includes('>')) { const v = rl.match(/>\s*([\d.]+)/); return rsi > (v ? parseFloat(v[1]) : 70); }
  }
  if (rl.includes('bollinger')) {
    const { upper, lower } = calcBollinger(closes);
    if (lower === null) return false;
    if (rl.includes('below lower')) return currentPrice < lower;
    if (rl.includes('above upper')) return currentPrice > upper;
  }
  if (rl.includes('ma(') || rl.includes('moving average')) {
    const pm = rl.match(/ma\((\d+)\)/);
    const ma = calcMA(closes, pm ? parseInt(pm[1]) : 50);
    if (rl.includes('price above') || rl.includes('above ma')) return currentPrice > ma;
    if (rl.includes('price below') || rl.includes('below ma')) return currentPrice < ma;
  }
  return false;
}

// ── Load/save log ──────────────────────────────────────────────────────────────

function loadLog() {
  try {
    if (fs.existsSync(MONITOR_LOG)) return JSON.parse(fs.readFileSync(MONITOR_LOG, 'utf8'));
  } catch {}
  return { position: null, trades: [], checks: 0 };
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(MONITOR_LOG), { recursive: true });
  fs.writeFileSync(MONITOR_LOG, JSON.stringify(log, null, 2));
}

// ── Main check ─────────────────────────────────────────────────────────────────

async function check() {
  const ts = new Date().toISOString();
  console.log(`\n[${new Date().toLocaleTimeString()}] Checking...`);

  // Load active strategy
  if (!fs.existsSync(ACTIVE_STRATEGY)) {
    console.log('   ⚠️  No active_strategy.json — run reasoning bot first.');
    return;
  }

  const active   = JSON.parse(fs.readFileSync(ACTIVE_STRATEGY, 'utf8'));
  const log      = loadLog();
  log.checks++;

  console.log(`   Strategy: ${active.name}`);

  // Fetch live data
  let prices, candles;
  try {
    [prices, candles] = await Promise.all([
      fetchLivePrices(['XBTUSD']),
      fetchOHLC('XBTUSD', 1440, 60)
    ]);
  } catch (e) {
    console.log(`   ❌ Data fetch failed: ${e.message}`);
    return;
  }

  const ticker       = prices['XBTUSD'] || prices['XXBTZUSD'];
  if (!ticker) { console.log('   ❌ No BTC price data'); return; }
  const currentPrice = ticker.price;
  console.log(`   BTC: $${currentPrice.toLocaleString()}`);

  // Get strategy rules from selector
  let entryRules = [], exitRules = [], stopPct = 8, targetPct = 15, maxHold = 10;

  try {
    const selectorContent = fs.readFileSync(
      path.join(__dirname, 'reasoning-bot/strategy_selector.js'), 'utf8'
    );
    // Find strategy params
    const stratId = active.strategy;
    const stratMatch = selectorContent.match(
      new RegExp(`'${stratId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*\\{([\\s\\S]*?)\\}`)
    );
    if (stratMatch) {
      const block = stratMatch[1];
      const tgt   = block.match(/"target":\s*([\d.]+)/);
      const stp   = block.match(/"stop":\s*([\d.]+)/);
      const hld   = block.match(/"hold":\s*([\d.]+)/);
      if (tgt) targetPct = parseFloat(tgt[1]);
      if (stp) stopPct   = parseFloat(stp[1]);
      if (hld) maxHold   = Math.round(parseFloat(hld[1]));
    }
  } catch {}

  // Get semantic entry/exit rules from capsule if available
  try {
    const scpDir = path.join(process.env.HOME, 'cce/engines/scp');
    const capsuleDir = fs.readdirSync(scpDir).find(d => d.includes(active.strategy.split('_').slice(0,4).join('_')));
    if (capsuleDir) {
      const capsule = JSON.parse(fs.readFileSync(path.join(scpDir, capsuleDir, 'capsule.json'), 'utf8'));
      entryRules = capsule.semantic_context?.entry_rules || [];
      exitRules  = capsule.semantic_context?.exit_rules  || [];
    }
  } catch {}

  // Evaluate conditions
  if (!log.position) {
    // Check entry
    if (!entryRules.length) {
      console.log('   ℹ️  No semantic entry rules — using stop/target monitoring only');
    } else {
      const entryMet = entryRules.every(r => evaluateRule(r, candles, currentPrice));
      console.log(`   Entry conditions: ${entryMet ? '✅ MET' : '⏳ Not yet'}`);
      entryRules.forEach(r => {
        const met = evaluateRule(r, candles, currentPrice);
        console.log(`     ${met ? '✅' : '❌'} ${r}`);
      });

      if (entryMet) {
        log.position = {
          entered_at:   ts,
          entry_price:  currentPrice,
          target_price: Math.round(currentPrice * (1 + targetPct / 100) * 100) / 100,
          stop_price:   Math.round(currentPrice * (1 - stopPct   / 100) * 100) / 100,
          max_exit:     new Date(Date.now() + maxHold * 24 * 60 * 60 * 1000).toISOString(),
          strategy:     active.name
        };
        console.log(`\n   🟢 DRY RUN ENTRY @ $${currentPrice.toLocaleString()}`);
        console.log(`      Target: $${log.position.target_price.toLocaleString()} (+${targetPct}%)`);
        console.log(`      Stop:   $${log.position.stop_price.toLocaleString()} (-${stopPct}%)`);
        console.log(`      Max hold: ${maxHold} days`);
      }
    }
  } else {
    // Check exit
    const pos        = log.position;
    const pnlPct     = Math.round((currentPrice - pos.entry_price) / pos.entry_price * 10000) / 100;
    const hitTarget  = currentPrice >= pos.target_price;
    const hitStop    = currentPrice <= pos.stop_price;
    const hitTimeout = new Date() >= new Date(pos.max_exit);
    const exitMet    = exitRules.length ? exitRules.some(r => evaluateRule(r, candles, currentPrice)) : false;

    console.log(`\n   📊 OPEN POSITION`);
    console.log(`      Entry:   $${pos.entry_price.toLocaleString()}`);
    console.log(`      Current: $${currentPrice.toLocaleString()}`);
    console.log(`      P&L:     ${pnlPct >= 0 ? '+' : ''}${pnlPct}%`);
    console.log(`      Target:  $${pos.target_price.toLocaleString()} ${hitTarget ? '✅ HIT' : '⏳'}`);
    console.log(`      Stop:    $${pos.stop_price.toLocaleString()}   ${hitStop ? '🔴 HIT' : '⏳'}`);

    if (hitTarget || hitStop || hitTimeout || exitMet) {
      const reason = hitTarget ? 'take_profit' : hitStop ? 'stop_loss' : hitTimeout ? 'timeout' : 'exit_rule';
      const icon   = pnlPct > 0 ? '✅' : '❌';
      console.log(`\n   ${icon} DRY RUN EXIT @ $${currentPrice.toLocaleString()} (${pnlPct >= 0 ? '+' : ''}${pnlPct}%) — ${reason}`);
      log.trades.push({
        strategy:    pos.strategy,
        entry_price: pos.entry_price,
        exit_price:  currentPrice,
        pnl_pct:     pnlPct,
        win:         pnlPct > 0,
        reason,
        entered_at:  pos.entered_at,
        exited_at:   ts
      });
      log.position = null;

      // Print running stats
      const wins = log.trades.filter(t => t.win).length;
      const wr   = Math.round(wins / log.trades.length * 100);
      console.log(`\n   📈 Dry run stats: ${log.trades.length} trades | WR: ${wr}% | Last: ${pnlPct >= 0 ? '+' : ''}${pnlPct}%`);
    }
  }

  saveLog(log);
  console.log(`   Checks: ${log.checks} | Trades: ${log.trades.length}`);
}

// ── Entry ──────────────────────────────────────────────────────────────────────

const once = process.argv.includes('--once');

if (once) {
  check().catch(console.error);
} else {
  console.log('🔍 FORGE MONITOR — Dry Run Mode');
  console.log(`   Checking every ${POLL_INTERVAL_MS / 60000} minutes`);
  console.log('   Ctrl+C to stop\n');
  check().catch(console.error);
  setInterval(() => check().catch(console.error), POLL_INTERVAL_MS);
}
