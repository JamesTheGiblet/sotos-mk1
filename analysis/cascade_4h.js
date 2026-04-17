#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

const ASSETS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD'];

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🌊 CASCADE EFFECT ANALYSIS — 4H TIMEFRAME');
  console.log('='.repeat(70));
  console.log('More events, faster signals, better statistics\n');

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Load all candles (4H interval)
  const candles = {};
  for (const asset of ASSETS) {
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = '4H'
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

  // Calculate 4H returns
  const returns = {};
  for (const asset of ASSETS) {
    returns[asset] = [];
    for (let i = 1; i < candles[asset].length; i++) {
      const ret = (candles[asset][i].close - candles[asset][i-1].close) / candles[asset][i-1].close * 100;
      returns[asset].push(ret);
    }
  }

  console.log(`📊 Data loaded:`);
  for (const asset of ASSETS) {
    console.log(`   ${asset}: ${returns[asset].length} 4H returns`);
  }

  // Find cascade patterns with larger samples
  console.log('\n' + '='.repeat(70));
  console.log('📉 DOWNSIDE CASCADES (Drop → Bounce)');
  console.log('='.repeat(70));
  
  const thresholds = [2, 3, 4, 5, 6, 7, 8];
  const results = [];

  for (const source of ['ETH/USD', 'BTC/USD']) {
    const sourceReturns = returns[source];
    
    for (const target of ['XRP/USD', 'SOL/USD', 'LINK/USD', 'LTC/USD']) {
      if (source === target) continue;
      
      const targetReturns = returns[target];
      
      for (const threshold of thresholds) {
        // Find 4H candles where source dropped > threshold
        const dropIndices = [];
        for (let i = 0; i < sourceReturns.length; i++) {
          if (sourceReturns[i] < -threshold) {
            dropIndices.push(i);
          }
        }
        
        if (dropIndices.length < 15) continue;  // Need at least 15 events
        
        // Calculate target returns after drop
        const responses = {
          day0: [], day1: [], day2: [], day3: [], day4: [], day5: [], day6: [], day7: [],
          day8: [], day9: [], day10: [], day11: [], day12: [], day13: [], day14: []
        };
        
        for (const idx of dropIndices) {
          for (let offset = 0; offset <= 14; offset++) {
            const responseIdx = idx + offset;
            if (responseIdx < targetReturns.length) {
              responses[`day${offset}`].push(targetReturns[responseIdx]);
            }
          }
        }
        
        // Find best offset
        let bestOffset = 1;
        let bestWinRate = 0;
        let bestAvgReturn = 0;
        
        for (let offset = 1; offset <= 7; offset++) {
          const returns_at_offset = responses[`day${offset}`];
          if (returns_at_offset.length > 0) {
            const avg = returns_at_offset.reduce((a,b) => a+b, 0) / returns_at_offset.length;
            const winRate = returns_at_offset.filter(r => r > 0).length / returns_at_offset.length * 100;
            if (winRate > bestWinRate && winRate > 55) {
              bestWinRate = winRate;
              bestOffset = offset;
              bestAvgReturn = avg;
            }
          }
        }
        
        if (bestWinRate > 60 && dropIndices.length >= 15) {
          results.push({
            source, target, threshold,
            events: dropIndices.length,
            bestOffset,
            avgReturn: bestAvgReturn,
            winRate: bestWinRate
          });
        }
      }
    }
  }

  // Sort and display best patterns
  results.sort((a, b) => b.winRate - a.winRate);
  
  console.log('\n🏆 BEST 4H CASCADE PATTERNS (≥15 events):');
  console.log('-'.repeat(80));
  
  for (const r of results.slice(0, 15)) {
    console.log(`\n🎯 ${r.source} drop >${r.threshold}% → ${r.target}`);
    console.log(`   Events: ${r.events} | Day +${r.bestOffset} | Avg: ${r.avgReturn >= 0 ? '+' : ''}${r.avgReturn.toFixed(2)}% | WR: ${r.winRate.toFixed(0)}%`);
  }

  // Also check for pump fades (upside reversals)
  console.log('\n' + '='.repeat(70));
  console.log('📈 UPSIDE FADES (Pump → Reversal)');
  console.log('='.repeat(70));
  
  const pumpResults = [];
  
  for (const source of ['ETH/USD', 'BTC/USD', 'SOL/USD']) {
    const sourceReturns = returns[source];
    
    for (const target of ASSETS) {
      if (source === target) continue;
      
      const targetReturns = returns[target];
      
      for (const threshold of [3, 4, 5, 6, 7, 8]) {
        const pumpIndices = [];
        for (let i = 0; i < sourceReturns.length; i++) {
          if (sourceReturns[i] > threshold) {
            pumpIndices.push(i);
          }
        }
        
        if (pumpIndices.length < 15) continue;
        
        // Look for negative returns after pump (fade)
        for (let offset = 1; offset <= 4; offset++) {
          const responses = [];
          for (const idx of pumpIndices) {
            if (idx + offset < targetReturns.length) {
              responses.push(targetReturns[idx + offset]);
            }
          }
          
          if (responses.length >= 15) {
            const avg = responses.reduce((a,b) => a+b, 0) / responses.length;
            const winRateDown = responses.filter(r => r < 0).length / responses.length * 100;
            
            if (avg < -0.3 && winRateDown > 55) {
              pumpResults.push({
                source, target, threshold, offset,
                events: responses.length,
                avgReturn: avg,
                winRateDown: winRateDown
              });
            }
          }
        }
      }
    }
  }
  
  pumpResults.sort((a, b) => b.winRateDown - a.winRateDown);
  
  console.log('\n🏆 BEST 4H PUMP FADE PATTERNS (≥15 events):');
  console.log('-'.repeat(80));
  
  for (const r of pumpResults.slice(0, 10)) {
    console.log(`\n🎯 ${r.source} pump >${r.threshold}% → ${r.target} fades`);
    console.log(`   Events: ${r.events} | Day +${r.offset} | Avg: ${r.avgReturn >= 0 ? '+' : ''}${r.avgReturn.toFixed(2)}% | WR (down): ${r.winRateDown.toFixed(0)}%`);
  }

  // ETH crash → XRP bounce detailed analysis
  console.log('\n' + '='.repeat(70));
  console.log('🔍 DETAILED: ETH Crash → XRP Bounce (4H)');
  console.log('='.repeat(70));
  
  const ethReturns = returns['ETH/USD'];
  const xrpReturns = returns['XRP/USD'];
  
  for (const threshold of [3, 4, 5, 6, 7, 8]) {
    const dropIndices = [];
    for (let i = 0; i < ethReturns.length; i++) {
      if (ethReturns[i] < -threshold) {
        dropIndices.push(i);
      }
    }
    
    if (dropIndices.length < 10) continue;
    
    console.log(`\n📊 ETH drop >${threshold}% (${dropIndices.length} events):`);
    
    for (let offset = 1; offset <= 8; offset++) {
      const responses = [];
      for (const idx of dropIndices) {
        if (idx + offset < xrpReturns.length) {
          responses.push(xrpReturns[idx + offset]);
        }
      }
      
      if (responses.length > 0) {
        const avg = responses.reduce((a,b) => a+b, 0) / responses.length;
        const winRate = responses.filter(r => r > 0).length / responses.length * 100;
        const up = avg >= 0 ? '+' : '';
        console.log(`   Day +${offset}: ${up}${avg.toFixed(2)}% (${winRate.toFixed(0)}% WR) | n=${responses.length}`);
      }
    }
  }

  // BTC crash → XRP bounce
  console.log('\n' + '='.repeat(70));
  console.log('🔍 DETAILED: BTC Crash → XRP Bounce (4H)');
  console.log('='.repeat(70));
  
  const btcReturns = returns['BTC/USD'];
  
  for (const threshold of [3, 4, 5, 6]) {
    const dropIndices = [];
    for (let i = 0; i < btcReturns.length; i++) {
      if (btcReturns[i] < -threshold) {
        dropIndices.push(i);
      }
    }
    
    if (dropIndices.length < 10) continue;
    
    console.log(`\n📊 BTC drop >${threshold}% (${dropIndices.length} events):`);
    
    for (let offset = 1; offset <= 8; offset++) {
      const responses = [];
      for (const idx of dropIndices) {
        if (idx + offset < xrpReturns.length) {
          responses.push(xrpReturns[idx + offset]);
        }
      }
      
      if (responses.length > 0) {
        const avg = responses.reduce((a,b) => a+b, 0) / responses.length;
        const winRate = responses.filter(r => r > 0).length / responses.length * 100;
        const up = avg >= 0 ? '+' : '';
        console.log(`   Day +${offset}: ${up}${avg.toFixed(2)}% (${winRate.toFixed(0)}% WR) | n=${responses.length}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ 4H Cascade Analysis Complete');
  console.log('='.repeat(70));
}

main().catch(console.error);
