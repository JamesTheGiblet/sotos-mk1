#!/usr/bin/env node
/**
 * regime_watcher.js
 * Runs daily after ki-collector. Detects regime changes from daily candles.
 * If regime has changed for 3 consecutive days, triggers forge_auto.js
 * to generate a new strategy for the new conditions.
 *
 * Usage:
 *   node regime_watcher.js
 */

'use strict';
const cs = require('./chronoscribe');

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const Database     = require('better-sqlite3');

const DB_PATH      = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const STATE_FILE   = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/regime_state.json');
const ARCHIVE_FILE = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/strategy_archive.json');
const BASE         = path.join(process.env.HOME, 'kraken-intelligence');

const REGIME_THRESHOLD = 3;

// ── Indicators ─────────────────────────────────────────────────────────────────

function calcRegime(candles) {
  if (candles.length < 20) return 'RANGING';
  const prices  = candles.slice(-20).map(c => c.close);
  const returns = prices.slice(1).map((p, j) => (p - prices[j]) / prices[j] * 100);
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;
  const vol14   = Math.sqrt(returns.slice(-14).reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 14);
  const trend20 = (prices[prices.length - 1] - prices[0]) / prices[0] * 100;
  if (Math.abs(trend20) > 15 && vol14 > 2) return trend20 > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
  if (vol14 > 3)   return 'VOLATILE';
  if (vol14 < 1.5) return 'QUIET';
  return 'RANGING';
}

// ── Load candles ───────────────────────────────────────────────────────────────

async function loadCandles(limit) {
  limit = limit || 200;
  const db   = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC LIMIT ?').all('BTC/USD', '1D', limit);
  db.close();
  return rows;
}

// ── State ──────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {}
  return { current_regime: 'UNKNOWN', last_trigger: null, last_checked: null };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Archive ────────────────────────────────────────────────────────────────────

function archiveStrategy(strategy, reason) {
  let archive = { version: "1.0.0", archived_strategies: [], summary: { total_archived: 0 } };
  try {
    if (fs.existsSync(ARCHIVE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
      if (Array.isArray(parsed)) archive.archived_strategies = parsed;
      else archive = parsed;
    }
  } catch (e) {}

  if (!archive.archived_strategies) archive.archived_strategies = [];

  archive.archived_strategies.unshift({ ...strategy, archived_at: new Date().toISOString(), reason: reason });
  
  archive.summary = archive.summary || {};
  archive.summary.total_archived = archive.archived_strategies.length;
  archive.last_updated = new Date().toISOString();
  archive.archived_strategies = archive.archived_strategies.slice(0, 100);

  fs.mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
  console.log('   📦 Archived: ' + strategy.name + ' — ' + reason);
}

// ── Score ──────────────────────────────────────────────────────────────────────

function scoreFromMetrics(wr, ret) {
  return Math.round((parseFloat(wr) * 0.6 + Math.max(0, parseFloat(ret)) * 0.4) * 10) / 10;
}

function getCurrentStrategyScore() {
  try {
    const content = fs.readFileSync(path.join(BASE, 'reasoning-bot/strategy_selector.js'), 'utf8');
    const active  = JSON.parse(fs.readFileSync(path.join(BASE, 'reasoning-bot/active_strategy.json'), 'utf8'));
    const stratId = active.strategy;
    const lines   = content.split('\n');
    let inStrategy = false, wr = 0, ret = 0;
    for (const line of lines) {
      if (line.includes("'" + stratId + "'")) inStrategy = true;
      if (inStrategy) {
        const wrM  = line.match(/"win_rate":\s*"([\d.]+)%"/);
        const retM = line.match(/"backtest_return":\s*"([+-]?[\d.]+)%"/);
        if (wrM)  wr  = parseFloat(wrM[1]);
        if (retM) ret = parseFloat(retM[1]);
        if (line.trim() === '}' && wr > 0) break;
      }
    }
    return { id: stratId, name: active.name, score: scoreFromMetrics(wr, ret), wr, ret };
  } catch (e) { return { id: null, name: 'Unknown', score: 0 }; }
}

// ── Trigger Forge ──────────────────────────────────────────────────────────────

function triggerForge() {
  console.log('\n   ⚙️  Triggering Forge auto loop...');
  try {
    const output   = execSync('cd ' + BASE + ' && node forge_auto.js 5', { encoding: 'utf8', timeout: 300000 });
    const passed   = output.includes('SUCCESS');
    const nameLine = output.match(/\u2192 (.+)/);
    const wrLine   = output.match(/([\d.]+)%\s*WR/i);
    const retLine  = output.match(/([+-][\d.]+)%\s*return/i);
    if (passed && nameLine && wrLine && retLine) {
      const wr  = parseFloat(wrLine[1]);
      const ret = parseFloat(retLine[1]);
      return { passed: true, name: nameLine[1].trim(), wr, ret, score: scoreFromMetrics(wr, ret) };
    }
    return { passed: false };
  } catch (e) {
    console.log('   ❌ Forge loop error: ' + e.message);
    return { passed: false, error: e.message };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function watch() {
  console.log('\n' + '═'.repeat(50));
  console.log('📉 REGIME WATCHER');
  console.log('═'.repeat(50));
  console.log('   Threshold: ' + REGIME_THRESHOLD + ' consecutive days in new regime');

  const candles = await loadCandles(200);
  if (!candles.length) { console.log('   ⚠️  No candle data available'); return; }

  // Calculate regime for last 3 daily candles
  const last3 = [];
  for (let i = 2; i >= 0; i--) {
    const slice = candles.slice(0, candles.length - i);
    last3.push({ regime: calcRegime(slice), date: new Date(candles[candles.length - 1 - i].timestamp * 1000).toISOString().slice(0, 10) });
  }

  console.log('\n   📊 Last 3 daily regimes:');
  last3.forEach(d => console.log('   ' + d.date + ' — ' + d.regime));

  const state       = loadState();
  const todayRegime = last3[2].regime;
  const allSame     = last3.every(d => d.regime === todayRegime);
  const changed     = todayRegime !== state.current_regime && state.current_regime !== 'UNKNOWN';

  console.log('\n   💾 Stored regime: ' + state.current_regime);
  console.log('   📅 Today regime:  ' + todayRegime);

  if (!allSame) {
    console.log('   ⏳ Regime not stable for 3 days yet — watching');
    state.last_checked = new Date().toISOString();
    saveState(state);
    return;
  }

  if (!changed) {
    console.log('   ✅ Regime stable — no change');
    state.current_regime = todayRegime;
    state.last_checked   = new Date().toISOString();
    saveState(state);
    return;
  }

  // Confirmed regime change
  console.log('\n   🚨 REGIME CHANGE: ' + state.current_regime + ' to ' + todayRegime);
  console.log('   ⚡ Stable 3 days. Generating new strategy...');

  // Record to ChronoScribe
  const currentPrice = candles[candles.length - 1].close;
  cs.recordRegimeChange(state.current_regime, todayRegime, 3, currentPrice);

  const current = getCurrentStrategyScore();
  console.log('   🧠 Current strategy: ' + current.name + ' (score: ' + current.score + ')');

  const result = triggerForge();

  if (!result.passed) {
    console.log('   ⚠️  Forge did not produce a passing strategy — keeping current');
  } else {
    console.log('   ✨ New strategy: ' + result.name + ' (score: ' + result.score + ')');
    if (result.score > current.score) {
      console.log('   🏆 New strategy wins (' + result.score + ' vs ' + current.score + ') — replaced in pool');
    } else {
      console.log('   🗑️  New strategy loses (' + result.score + ' vs ' + current.score + ') — archiving');
      archiveStrategy({ name: result.name, score: result.score, regime: todayRegime },
        'Lower score than current (' + result.score + ' vs ' + current.score + ')');
    }
  }

  state.current_regime = todayRegime;
  state.last_trigger   = new Date().toISOString();
  state.last_checked   = new Date().toISOString();
  saveState(state);
  console.log('\n' + '═'.repeat(50));
}

watch().catch(console.error);
