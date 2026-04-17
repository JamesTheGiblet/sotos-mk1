#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

const ASSETS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD', 'DOGE/USD'];

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🌊 CASCADE EFFECT ANALYSIS');
  console.log('='.repeat(70));
  console.log('When one asset moves big, what happens to others?\n');

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Load all candles
  const candles = {};
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
      candles[asset] = values.map(row => {
        const c = {};
        columns.forEach((col, i) => c[col] = row[i]);
        return c;
      });
    }
  }
  db.close();

  // Calculate returns for all assets
  const returns = {};
  for (const asset of ASSETS) {
    returns[asset] = [];
    for (let i = 1; i < candles[asset].length; i++) {
      const ret = (candles[asset][i].close - candles[asset][i-1].close) / candles[asset][i-1].close * 100;
      returns[asset].push(ret);
    }
  }

  // Find best cascade patterns
  console.log('📊 SEARCHING FOR CASCADE PATTERNS');
  console.log('-'.repeat(70));
  
  // Look for situations where a big drop in one asset predicts a bounce in another
  const thresholds = [3, 4, 5, 6, 7, 8, 10];
  
  for (const source of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
    const sourceReturns = returns[source];
    
    for (const target of ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD', 'DOGE/USD']) {
      if (source === target) continue;
      
      const targetReturns = returns[target];
      
      for (const threshold of thresholds) {
        // Find days when source dropped > threshold
        const dropDays = [];
        for (let i = 0; i < sourceReturns.length; i++) {
          if (sourceReturns[i] < -threshold) {
            dropDays.push(i);
          }
        }
        
        if (dropDays.length < 3) continue;
        
        // Calculate target returns on subsequent days
        const day0 = [];
        const day1 = [];
        const day2 = [];
        const day3 = [];
        const day5 = [];
        const day7 = [];
        const day14 = [];
        
        for (const d of dropDays) {
          if (d < targetReturns.length) day0.push(targetReturns[d]);
          if (d + 1 < targetReturns.length) day1.push(targetReturns[d + 1]);
          if (d + 2 < targetReturns.length) day2.push(targetReturns[d + 2]);
          if (d + 3 < targetReturns.length) day3.push(targetReturns[d + 3]);
          if (d + 5 < targetReturns.length) day5.push(targetReturns[d + 5]);
          if (d + 7 < targetReturns.length) day7.push(targetReturns[d + 7]);
          if (d + 14 < targetReturns.length) day14.push(targetReturns[d + 14]);
        }
        
        const avg0 = day0.reduce((a,b) => a+b, 0) / day0.length;
        const avg1 = day1.reduce((a,b) => a+b, 0) / day1.length;
        const avg2 = day2.reduce((a,b) => a+b, 0) / day2.length;
        const avg3 = day3.reduce((a,b) => a+b, 0) / day3.length;
        const avg5 = day5.reduce((a,b) => a+b, 0) / day5.length;
        const avg7 = day7.reduce((a,b) => a+b, 0) / day7.length;
        const avg14 = day14.reduce((a,b) => a+b, 0) / day14.length;
        
        const win0 = day0.filter(r => r > 0).length / day0.length * 100;
        const win1 = day1.filter(r => r > 0).length / day1.length * 100;
        const win2 = day2.filter(r => r > 0).length / day2.length * 100;
        const win3 = day3.filter(r => r > 0).length / day3.length * 100;
        const win5 = day5.filter(r => r > 0).length / day5.length * 100;
        const win7 = day7.filter(r => r > 0).length / day7.length * 100;
        const win14 = day14.filter(r => r > 0).length / day14.length * 100;
        
        // Only show if there's a clear pattern (positive avg and >55% win rate on day+1 or day+2)
        if ((avg1 > 0.5 || avg2 > 0.5) && (win1 > 55 || win2 > 55)) {
          console.log(`\n🎯 ${source} drop >${threshold}% → ${target} (${dropDays.length} events)`);
          console.log(`   Day 0: ${avg0 >= 0 ? '+' : ''}${avg0.toFixed(2)}% (${win0.toFixed(0)}% WR)`);
          console.log(`   Day +1: ${avg1 >= 0 ? '+' : ''}${avg1.toFixed(2)}% (${win1.toFixed(0)}% WR)`);
          console.log(`   Day +2: ${avg2 >= 0 ? '+' : ''}${avg2.toFixed(2)}% (${win2.toFixed(0)}% WR)`);
          console.log(`   Day +3: ${avg3 >= 0 ? '+' : ''}${avg3.toFixed(2)}% (${win3.toFixed(0)}% WR)`);
          console.log(`   Day +5: ${avg5 >= 0 ? '+' : ''}${avg5.toFixed(2)}% (${win5.toFixed(0)}% WR)`);
          console.log(`   Day +7: ${avg7 >= 0 ? '+' : ''}${avg7.toFixed(2)}% (${win7.toFixed(0)}% WR)`);
          console.log(`   Day +14: ${avg14 >= 0 ? '+' : ''}${avg14.toFixed(2)}% (${win14.toFixed(0)}% WR)`);
        }
      }
    }
  }
  
  // Look for upside cascades (big pumps)
  console.log('\n' + '='.repeat(70));
  console.log('📈 UPSIDE CASCADES (Big pumps → what happens next?)');
  console.log('='.repeat(70));
  
  for (const source of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
    const sourceReturns = returns[source];
    
    for (const target of ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD', 'DOGE/USD']) {
      if (source === target) continue;
      
      const targetReturns = returns[target];
      
      for (const threshold of [5, 7, 10, 12, 15]) {
        const pumpDays = [];
        for (let i = 0; i < sourceReturns.length; i++) {
          if (sourceReturns[i] > threshold) {
            pumpDays.push(i);
          }
        }
        
        if (pumpDays.length < 3) continue;
        
        const day1 = [];
        const day2 = [];
        const day3 = [];
        
        for (const d of pumpDays) {
          if (d + 1 < targetReturns.length) day1.push(targetReturns[d + 1]);
          if (d + 2 < targetReturns.length) day2.push(targetReturns[d + 2]);
          if (d + 3 < targetReturns.length) day3.push(targetReturns[d + 3]);
        }
        
        const avg1 = day1.reduce((a,b) => a+b, 0) / day1.length;
        const avg2 = day2.reduce((a,b) => a+b, 0) / day2.length;
        const avg3 = day3.reduce((a,b) => a+b, 0) / day3.length;
        
        const win1 = day1.filter(r => r > 0).length / day1.length * 100;
        const win2 = day2.filter(r => r > 0).length / day2.length * 100;
        const win3 = day3.filter(r => r > 0).length / day3.length * 100;
        
        if ((avg1 < -0.3 || avg2 < -0.3) && (win1 < 45 || win2 < 45)) {
          console.log(`\n🎯 ${source} pump >${threshold}% → ${target} fades (${pumpDays.length} events)`);
          console.log(`   Day +1: ${avg1 >= 0 ? '+' : ''}${avg1.toFixed(2)}% (${win1.toFixed(0)}% WR)`);
          console.log(`   Day +2: ${avg2 >= 0 ? '+' : ''}${avg2.toFixed(2)}% (${win2.toFixed(0)}% WR)`);
          console.log(`   Day +3: ${avg3 >= 0 ? '+' : ''}${avg3.toFixed(2)}% (${win3.toFixed(0)}% WR)`);
        }
      }
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ Analysis complete');
  console.log('='.repeat(70));
}

main().catch(console.error);
