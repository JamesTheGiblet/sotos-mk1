#!/usr/bin/env node
'use strict';

const RuleEngine = require('../rules/engine');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

async function customDiscovery() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🔍 CUSTOM STRATEGY DISCOVERY');
  console.log('════════════════════════════════════════════════════════════\n');
  
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);
  
  // Get BTC candles
  const result = db.exec(
    `SELECT timestamp, open, high, low, close, volume
     FROM candles
     WHERE pair = 'BTC/USD' AND interval = '1D'
     ORDER BY timestamp ASC`
  );
  
  if (!result.length) return;
  
  const { columns, values } = result[0];
  const candles = values.map(row => {
    const candle = {};
    columns.forEach((col, i) => candle[col] = row[i]);
    return candle;
  });
  
  console.log(`Candles loaded: ${candles.length}\n`);
  
  const engine = new RuleEngine();
  const strategies = [];
  
  // Test specific pattern variations
  const patterns = [
    // Consecutive red variations
    { name: '2 red days', entry: { type: 'consecutive', params: { count: 2, direction: 'red' } } },
    { name: '3 red days', entry: { type: 'consecutive', params: { count: 3, direction: 'red' } } },
    { name: '5 red days', entry: { type: 'consecutive', params: { count: 5, direction: 'red' } } },
    
    // Z-score variations
    { name: 'Z-score < -1.5', entry: { type: 'zscore', params: { period: 30, compare: '<', value: -1.5 } } },
    { name: 'Z-score < -2', entry: { type: 'zscore', params: { period: 30, compare: '<', value: -2 } } },
    { name: 'Z-score < -2.5', entry: { type: 'zscore', params: { period: 30, compare: '<', value: -2.5 } } },
    
    // RSI variations
    { name: 'RSI < 25', entry: { type: 'rsi', params: { period: 14, compare: '<', value: 25 } } },
    { name: 'RSI < 20', entry: { type: 'rsi', params: { period: 14, compare: '<', value: 20 } } },
    
    // Combinations
    { name: '2 red + Z-score < -1', entry: { type: 'and', conditions: [
      { type: 'consecutive', params: { count: 2, direction: 'red' } },
      { type: 'zscore', params: { period: 30, compare: '<', value: -1 } }
    ] } },
    { name: '3 red + RSI < 30', entry: { type: 'and', conditions: [
      { type: 'consecutive', params: { count: 3, direction: 'red' } },
      { type: 'rsi', params: { period: 14, compare: '<', value: 30 } }
    ] } },
    { name: '4 red + Volume > 1.5x', entry: { type: 'and', conditions: [
      { type: 'consecutive', params: { count: 4, direction: 'red' } },
      { type: 'volume', params: { period: 14, compare: '>', multiplier: 1.5 } }
    ] } },
    
    // Exit parameter variations on 4 red days
    { name: '4 red + 2% target', entry: { type: 'consecutive', params: { count: 4, direction: 'red' } }, target: 2, stop: 1.5, hold: 5 },
    { name: '4 red + 3% target', entry: { type: 'consecutive', params: { count: 4, direction: 'red' } }, target: 3, stop: 2, hold: 7 },
    { name: '4 red + 0.5% target', entry: { type: 'consecutive', params: { count: 4, direction: 'red' } }, target: 0.5, stop: 0.4, hold: 3 },
  ];
  
  for (const pattern of patterns) {
    const strategy = {
      name: pattern.name,
      entryRules: pattern.entry,
      params: {
        targetPct: pattern.target || 1,
        stopPct: pattern.stop || 0.75,
        maxHoldDays: pattern.hold || 5
      }
    };
    
    const result = engine.backtest(candles, strategy);
    if (result.trades >= 10 && result.winRate >= 55 && result.totalReturn > 0) {
      strategies.push({
        name: pattern.name,
        trades: result.trades,
        winRate: result.winRate,
        totalReturn: result.totalReturn,
        sharpe: result.sharpe,
        params: strategy.params
      });
    }
  }
  
  // Sort by win rate
  strategies.sort((a, b) => b.winRate - a.winRate);
  
  console.log('\n📊 CUSTOM PATTERN RESULTS:');
  console.log('─'.repeat(80));
  console.log('  Pattern                          | Trades | WR%   | Return | Sharpe');
  console.log('─'.repeat(80));
  
  for (const s of strategies.slice(0, 20)) {
    console.log(`  ${s.name.padEnd(30)} | ${String(s.trades).padStart(4)}   | ${s.winRate.toFixed(0)}%   | ${s.totalReturn >= 0 ? '+' : ''}${s.totalReturn.toFixed(1)}% | ${s.sharpe.toFixed(2)}`);
  }
  
  db.close();
}

customDiscovery().catch(console.error);
