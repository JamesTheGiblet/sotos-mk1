#!/usr/bin/env node
'use strict';

/**
 * FORWARD TEST v2 — Exact GA Champion Parameters
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the EXACT signals found by smart_discovery.js, not approximations.
 *
 * BTC:  5-red OR RSI(14)<20          | next_close | tgt:5% stp:2.5% hold:14d
 * XRP:  RSI(7)<20 AND VOL(20)x1.5   | next_open  | tgt:4% stp:1.5% hold:7d
 * SOL:  RSI(14)<25                   | next_close | tgt:4% stp:2.5% trail:0.5% hold:7d
 *
 * Split: 80% train / 20% test (unseen)
 * Costs: 0.3% round trip
 */

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const COSTS   = { entry: 0.0015, exit: 0.0015 };

// ─────────────────────────────────────────────────────────────────────────────
// INDICATORS
// ─────────────────────────────────────────────────────────────────────────────

function calcRSI(candles, i, period) {
  if (i < period) return null;
  var gains = 0, losses = 0;
  for (var j = i - period + 1; j <= i; j++) {
    var d = candles[j].close - candles[j - 1].close;
    if (d > 0) gains += d; else losses -= d;
  }
  var ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return 100 - (100 / (1 + ag / al));
}

function calcVolAvg(candles, i, period) {
  if (i < period) return null;
  var sum = 0;
  for (var j = i - period; j < i; j++) sum += candles[j].volume;
  return sum / period;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKTEST — supports all GA signal types exactly
// ─────────────────────────────────────────────────────────────────────────────

function backtest(candles, strategy) {
  var capital   = 100;
  var position  = null;
  var trades    = [];
  var cRed      = 0;
  var highWater = 0;

  for (var i = 30; i < candles.length; i++) {
    var c = candles[i];

    // Market state — never reset on trade exit
    if (c.close < c.open) cRed++; else cRed = 0;

    // ── Entry signal ────────────────────────────────────────────────────────
    var shouldEnter = false;

    if (!position) {
      var sig = strategy.signal;

      if (sig.type === 'consecutive_red_or_rsi') {
        // BTC: 5-red OR RSI(14)<20
        var rsi14 = calcRSI(candles, i, sig.rsiPeriod);
        var rsiHit = rsi14 !== null && rsi14 < sig.rsiThreshold;
        shouldEnter = cRed >= sig.requiredRed || rsiHit;
      }

      else if (sig.type === 'rsi_and_volume') {
        // XRP: RSI(7)<20 AND VOL(20)x1.5
        var rsi7   = calcRSI(candles, i, sig.rsiPeriod);
        var volAvg = calcVolAvg(candles, i, sig.volPeriod);
        var rsiOk  = rsi7 !== null && rsi7 < sig.rsiThreshold;
        var volOk  = volAvg !== null && c.volume > volAvg * sig.volMultiplier;
        shouldEnter = rsiOk && volOk;
      }

      else if (sig.type === 'rsi_oversold') {
        // SOL: RSI(14)<25
        var rsiSol = calcRSI(candles, i, sig.rsiPeriod);
        shouldEnter = rsiSol !== null && rsiSol < sig.rsiThreshold;
      }

      else if (sig.type === 'consecutive_red') {
        shouldEnter = cRed >= sig.requiredRed;
      }
    }

    // ── Open position ────────────────────────────────────────────────────────
    if (!position && shouldEnter) {
      var timing = strategy.entryTiming;
      var ep;

      if (timing === 'next_open' && i + 1 < candles.length) {
        ep = candles[i + 1].open;
      } else if (timing === 'next_close' && i + 1 < candles.length) {
        ep = candles[i + 1].close;
      } else {
        ep = c.close;
      }

      capital  -= capital * COSTS.entry;
      position  = { ep: ep, ei: i, sz: capital };
      highWater = ep;
      continue;
    }

    // ── Manage position ──────────────────────────────────────────────────────
    if (position) {
      if (c.close > highWater) highWater = c.close;

      var pnl      = (c.close - position.ep) / position.ep * 100;
      var holdDays = i - position.ei;

      // Trailing stop
      var trailHit = false;
      if (strategy.trailingPct && strategy.trailingPct > 0 && pnl > 0) {
        var drawFromHigh = (highWater - c.close) / highWater * 100;
        if (drawFromHigh >= strategy.trailingPct) trailHit = true;
      }

      var hitTarget = pnl  >=  strategy.targetPct;
      var hitStop   = pnl  <= -strategy.stopPct;
      var hitHold   = holdDays >= strategy.maxHoldDays;

      if (hitTarget || hitStop || hitHold || trailHit) {
        var gross   = position.sz * (pnl / 100);
        var ec      = position.sz * COSTS.exit;
        capital    += gross - ec;
        var netPct  = ((gross - ec) / position.sz) * 100;

        trades.push({
          win:    netPct > 0,
          pnl:    netPct,
          hold:   holdDays,
          exit:   hitTarget ? 'target' : trailHit ? 'trail' : hitStop ? 'stop' : 'timeout'
        });

        position  = null;
        highWater = 0;
      }
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  var n = trades.length;
  if (n === 0) return { trades: 0, wr: 0, exp: 0, ret: 0, aw: 0, al: 0 };

  var wins   = trades.filter(function(t) { return t.win; });
  var losses = trades.filter(function(t) { return !t.win; });
  var wr     = wins.length / n * 100;
  var lr     = 1 - wr / 100;
  var aw     = wins.length   ? wins.reduce(function(s,t){return s+t.pnl;},0)   / wins.length   : 0;
  var al     = losses.length ? Math.abs(losses.reduce(function(s,t){return s+t.pnl;},0) / losses.length) : 0;
  var exp    = (wr / 100 * aw) - (lr * al);
  var ret    = (capital - 100) / 100 * 100;

  // Exit reason breakdown
  var exits = { target: 0, trail: 0, stop: 0, timeout: 0 };
  trades.forEach(function(t) { exits[t.exit]++; });

  return {
    trades: n, wr: +wr.toFixed(1), exp: +exp.toFixed(2),
    ret: +ret.toFixed(1), aw: +aw.toFixed(2), al: +al.toFixed(2),
    exits: exits, rawTrades: trades
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXACT GA CHAMPION DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

var STRATEGIES = [
  {
    id:    'btc_ga',
    name:  'BTC — 5-red OR RSI(14)<20',
    asset: 'BTC/USD',
    signal: {
      type:         'consecutive_red_or_rsi',
      requiredRed:  5,      // GA found 5, not 4
      rsiPeriod:    14,     // GA found 14, not 21
      rsiThreshold: 20
    },
    entryTiming:  'next_close',   // GA found next_close, not next_open
    targetPct:    5,
    stopPct:      2.5,
    trailingPct:  0,
    maxHoldDays:  14
  },
  {
    id:    'xrp_ga',
    name:  'XRP — RSI(7)<20 AND VOL(20)x1.5',
    asset: 'XRP/USD',
    signal: {
      type:          'rsi_and_volume',
      rsiPeriod:     7,     // fast RSI — critical
      rsiThreshold:  20,
      volPeriod:     20,
      volMultiplier: 1.5    // AND gate — both must fire
    },
    entryTiming:  'next_open',
    targetPct:    4,
    stopPct:      1.5,
    trailingPct:  0,
    maxHoldDays:  7
  },
  {
    id:    'sol_ga',
    name:  'SOL — RSI(14)<25',
    asset: 'SOL/USD',
    signal: {
      type:         'rsi_oversold',
      rsiPeriod:    14,
      rsiThreshold: 25
    },
    entryTiming:  'next_close',
    targetPct:    4,
    stopPct:      2.5,
    trailingPct:  0.5,     // 0.5% trailing stop
    maxHoldDays:  7
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('FORWARD TEST v2 — Exact GA Champion Parameters');
  console.log('='.repeat(70));
  console.log('Split: 80% train / 20% test (unseen)');
  console.log('Costs: 0.3% round trip\n');

  var SQL      = await initSqlJs();
  var db       = new SQL.Database(fs.readFileSync(DB_PATH));
  var results  = [];
  var dateStr  = function(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); };

  for (var si = 0; si < STRATEGIES.length; si++) {
    var strat  = STRATEGIES[si];
    var res    = db.exec(
      'SELECT timestamp,open,high,low,close,volume FROM candles WHERE pair=? AND interval=? ORDER BY timestamp ASC',
      [strat.asset, '1D']
    );

    if (!res.length) {
      console.log('No data for ' + strat.asset + ' — skipping');
      continue;
    }

    var col     = res[0].columns, vals = res[0].values;
    var candles = vals.map(function(row) {
      var c = {}; col.forEach(function(k, i) { c[k] = row[i]; }); return c;
    });

    var split  = Math.floor(candles.length * 0.8);
    var train  = candles.slice(0, split);
    var test   = candles.slice(split);

    var tr = backtest(train, strat);
    var te = backtest(test,  strat);

    var verdict;
    if (te.trades === 0)          verdict = 'NO TRADES';
    else if (te.ret > 0 && te.wr >= 55) verdict = 'PASS';
    else if (te.ret > 0)          verdict = 'MARGINAL';
    else                          verdict = 'FAIL';

    results.push({ strat: strat, tr: tr, te: te, verdict: verdict,
                   trainEnd: dateStr(train[train.length-1].timestamp),
                   testStart: dateStr(test[0].timestamp),
                   testEnd:   dateStr(test[test.length-1].timestamp) });
  }

  db.close();

  // ── Print results ──────────────────────────────────────────────────────────
  console.log('RESULTS\n' + '-'.repeat(70));

  results.forEach(function(r) {
    var icon = r.verdict === 'PASS' ? 'PASS' : r.verdict === 'MARGINAL' ? 'MARGINAL' : r.verdict === 'NO TRADES' ? 'NO TRADES' : 'FAIL';
    console.log('\n[' + icon + '] ' + r.strat.name);
    console.log('   Asset:      ' + r.strat.asset);
    console.log('   Train ends: ' + r.trainEnd + '  |  Test: ' + r.testStart + ' -> ' + r.testEnd);
    console.log('');
    console.log('   TRAIN:  ' + String(r.tr.trades).padStart(3) + ' trades | WR: ' + String(r.tr.wr).padStart(5) + '% | E: ' + String(r.tr.exp).padStart(5) + ' | R: ' + (r.tr.ret >= 0 ? '+' : '') + r.tr.ret + '%');
    console.log('   TEST:   ' + String(r.te.trades).padStart(3) + ' trades | WR: ' + String(r.te.wr).padStart(5) + '% | E: ' + String(r.te.exp).padStart(5) + ' | R: ' + (r.te.ret >= 0 ? '+' : '') + r.te.ret + '%');

    if (r.te.trades > 0) {
      console.log('   Exits:  target:' + r.te.exits.target + ' trail:' + r.te.exits.trail + ' stop:' + r.te.exits.stop + ' timeout:' + r.te.exits.timeout);
      console.log('   Avg win: +' + r.te.aw + '%  Avg loss: -' + r.te.al + '%');

      var wrDelta  = r.te.wr  - r.tr.wr;
      var retDelta = r.te.ret - r.tr.ret;
      console.log('   Degradation: WR ' + (wrDelta >= 0 ? '+' : '') + wrDelta.toFixed(1) + '%  |  Return ' + (retDelta >= 0 ? '+' : '') + retDelta.toFixed(1) + '%');
    }
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  var pass     = results.filter(function(r) { return r.verdict === 'PASS'; });
  var marginal = results.filter(function(r) { return r.verdict === 'MARGINAL'; });
  var fail     = results.filter(function(r) { return r.verdict === 'FAIL' || r.verdict === 'NO TRADES'; });

  if (pass.length) {
    console.log('\nPASS (' + pass.length + '):');
    pass.forEach(function(r) { console.log('  ' + r.strat.name + ' | test WR: ' + r.te.wr + '% | test R: +' + r.te.ret + '%'); });
  }
  if (marginal.length) {
    console.log('\nMARGINAL (' + marginal.length + ') — dry run only:');
    marginal.forEach(function(r) { console.log('  ' + r.strat.name + ' | test WR: ' + r.te.wr + '% | test R: +' + r.te.ret + '%'); });
  }
  if (fail.length) {
    console.log('\nFAIL / NO TRADES (' + fail.length + ') — do not deploy:');
    fail.forEach(function(r) { console.log('  ' + r.strat.name + ' | ' + r.verdict); });
  }

  console.log('\nNOTE: Test period is ~145 days (80/20 split on 723 candles).');
  console.log('      Low trade counts mean wide confidence intervals.');
  console.log('      All passing strategies require 30-day dry run before live capital.');
  console.log('\n' + '='.repeat(70));
  console.log('Forward test v2 complete');
  console.log('='.repeat(70) + '\n');
}

main().catch(function(e) { console.error('Fatal:', e.message); process.exit(1); });