#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

const ASSETS = ['LINK/USD', 'BTC/USD', 'LTC/USD'];
const STRATEGY = {
  requiredRed: 4,
  targetPct: 1,
  stopPct: 0.75,
  maxHoldDays: 5
};

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 PORTFOLIO OVERLAP ANALYSIS');
  console.log('═'.repeat(60));
  console.log(`Assets: ${ASSETS.join(', ')}`);
  console.log(`Strategy: ${STRATEGY.requiredRed} consecutive red days\n`);

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get candles for all assets
  const assetData = {};
  for (const asset of ASSETS) {
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = '1D'
       ORDER BY timestamp ASC`,
      [asset]
    );
    
    if (result.length) {
      const { columns, values } = result[0];
      assetData[asset] = values.map(row => {
        const candle = {};
        columns.forEach((col, i) => candle[col] = row[i]);
        return candle;
      });
    }
  }

  // Find all signal days per asset
  const signals = {};
  for (const asset of ASSETS) {
    signals[asset] = [];
    let consecutiveRed = 0;
    
    for (let i = 0; i < assetData[asset].length; i++) {
      const candle = assetData[asset][i];
      if (candle.close < candle.open) {
        consecutiveRed++;
      } else {
        consecutiveRed = 0;
      }
      
      if (consecutiveRed >= STRATEGY.requiredRed) {
        signals[asset].push({
          timestamp: candle.timestamp,
          date: new Date(candle.timestamp * 1000).toISOString().split('T')[0],
          price: candle.close
        });
      }
    }
  }

  // Count signals per asset
  console.log('Signal Counts:');
  for (const asset of ASSETS) {
    console.log(`  ${asset}: ${signals[asset].length} signals`);
  }

  // Find overlapping signals (same day across multiple assets)
  const overlapDays = {};
  
  for (const asset of ASSETS) {
    for (const signal of signals[asset]) {
      if (!overlapDays[signal.date]) {
        overlapDays[signal.date] = { date: signal.date, assets: [] };
      }
      overlapDays[signal.date].assets.push(asset);
    }
  }

  // Categorize overlaps
  let singleAsset = 0;
  let twoAsset = 0;
  let threeAsset = 0;
  
  for (const [date, data] of Object.entries(overlapDays)) {
    const count = data.assets.length;
    if (count === 1) singleAsset++;
    else if (count === 2) twoAsset++;
    else if (count === 3) threeAsset++;
  }

  const totalSignalDays = Object.keys(overlapDays).length;
  
  console.log('\nOverlap Statistics:');
  console.log(`  Total signal days: ${totalSignalDays}`);
  console.log(`  Single asset only: ${singleAsset} (${(singleAsset/totalSignalDays*100).toFixed(1)}%)`);
  console.log(`  Two assets same day: ${twoAsset} (${(twoAsset/totalSignalDays*100).toFixed(1)}%)`);
  console.log(`  ALL THREE same day: ${threeAsset} (${(threeAsset/totalSignalDays*100).toFixed(1)}%)`);

  // Show examples of triple overlaps
  if (threeAsset > 0) {
    console.log('\n🔴 Triple Overlap Days (all 3 assets signal same day):');
    const tripleDays = Object.entries(overlapDays)
      .filter(([date, data]) => data.assets.length === 3)
      .slice(0, 10);
    
    for (const [date, data] of tripleDays) {
      console.log(`  ${date}: ${data.assets.join(', ')}`);
    }
  }

  // Correlation analysis
  console.log('\n' + '─'.repeat(60));
  console.log('📈 CORRELATION ANALYSIS');
  console.log('─'.repeat(60));
  
  // Calculate daily returns for correlation
  const returns = {};
  for (const asset of ASSETS) {
    returns[asset] = [];
    for (let i = 1; i < assetData[asset].length; i++) {
      const ret = (assetData[asset][i].close - assetData[asset][i-1].close) / assetData[asset][i-1].close;
      returns[asset].push(ret);
    }
  }
  
  // Align lengths
  const minLen = Math.min(...ASSETS.map(a => returns[a].length));
  
  function correlation(a, b) {
    let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
    const n = minLen;
    for (let i = 0; i < n; i++) {
      sumA += a[i];
      sumB += b[i];
      sumAB += a[i] * b[i];
      sumA2 += a[i] * a[i];
      sumB2 += b[i] * b[i];
    }
    const numerator = n * sumAB - sumA * sumB;
    const denominator = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
    return denominator === 0 ? 0 : numerator / denominator;
  }
  
  console.log('\nDaily Return Correlations:');
  console.log(`  LINK vs BTC: ${correlation(returns['LINK/USD'], returns['BTC/USD']).toFixed(3)}`);
  console.log(`  LINK vs LTC: ${correlation(returns['LINK/USD'], returns['LTC/USD']).toFixed(3)}`);
  console.log(`  BTC vs LTC:  ${correlation(returns['BTC/USD'], returns['LTC/USD']).toFixed(3)}`);
  
  // Risk calculation
  console.log('\n' + '─'.repeat(60));
  console.log('⚠️ RISK ASSESSMENT');
  console.log('─'.repeat(60));
  
  // Calculate max concurrent exposure
  let maxConcurrent = 0;
  let currentConcurrent = 0;
  const positionTracker = {};
  
  for (const asset of ASSETS) {
    positionTracker[asset] = { active: false, entryDate: null, exitDate: null };
  }
  
  // Simplified: track positions based on signal + hold period
  const allDays = [...new Set(ASSETS.flatMap(a => assetData[a].map(c => c.timestamp)))].sort();
  
  for (const ts of allDays) {
    let concurrent = 0;
    for (const asset of ASSETS) {
      // Check if this asset had a signal in the last 5 days
      const assetSignals = signals[asset];
      const hasActivePosition = assetSignals.some(s => {
        const daysDiff = Math.floor((ts - s.timestamp) / 86400);
        return daysDiff >= 0 && daysDiff <= 5;
      });
      if (hasActivePosition) concurrent++;
    }
    if (concurrent > maxConcurrent) maxConcurrent = concurrent;
  }
  
  console.log(`  Max concurrent positions: ${maxConcurrent} / ${ASSETS.length}`);
  console.log(`  Portfolio diversification: ${maxConcurrent === ASSETS.length ? 'POOR - All assets move together' : 'MODERATE'}`);
  
  // Recommendation
  console.log('\n' + '═'.repeat(60));
  console.log('🎯 RECOMMENDATION');
  console.log('═'.repeat(60));
  
  if (threeAsset > 5) {
    console.log('\n⚠️ HIGH CORRELATION DETECTED');
    console.log(`   ${threeAsset} days where all 3 assets signal simultaneously`);
    console.log('\n   Suggestions:');
    console.log('   1. Add position sizing limits (max 2 concurrent positions)');
    console.log('   2. Reduce allocation per asset (e.g., 25% each instead of 40/40/20)');
    console.log('   3. Add a correlation filter (skip signals if >1 asset already in position)');
    console.log('   4. Consider adding uncorrelated assets (e.g., gold, bonds)');
  } else {
    console.log('\n✅ ACCEPTABLE CORRELATION');
    console.log(`   Only ${threeAsset} triple-overlap days out of ${totalSignalDays} total`);
    console.log('   Portfolio diversification is reasonable');
  }
  
  db.close();
}

main().catch(console.error);
