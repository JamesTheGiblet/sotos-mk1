#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

const ASSETS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD'];

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🌊 CASCADE EFFECT ANALYSIS — 1H TIMEFRAME');
  console.log('='.repeat(70));
  console.log('Maximum events, fastest signals\n');

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Load all candles (1H interval)
  const candles = {};
  for (const asset of ASSETS) {
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = '1H'
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

  // Calculate 1H returns
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
    console.log(`   ${asset}: ${returns[asset].length} 1H returns (~${Math.floor(returns[asset].length / 24)} days)`);
  }

  // Find cascade patterns
  console.log('\n' + '='.repeat(70));
  console.log('📉 DOWNSIDE CASCADES (Drop → Bounce)');
  console.log('='.repeat(70));
  
  const thresholds = [1, 1.5, 2, 2.5, 3, 4, 5];
  const results = [];

  for (const source of ['ETH/USD', 'BTC/USD', 'SOL/USD']) {
    const sourceReturns = returns[source];
    
    for (const target of ['XRP/USD', 'LINK/USD', 'SOL/USD', 'LTC/USD', 'BTC/USD', 'ETH/USD']) {
      if (source === target) continue;
      
      const targetReturns = returns[target];
      
      for (const threshold of thresholds) {
        // Find 1H candles where source dropped > threshold
        const dropIndices = [];
        for (let i = 1; i < sourceReturns.length; i++) {
          if (sourceReturns[i] < -threshold) {
            dropIndices.push(i);
          }
        }
        
        if (dropIndices.length < 30) continue;  // Need at least 30 events for 1H
        
        // Calculate target returns at different offsets
        const best = { offset: 1, winRate: 0, avgReturn: 0, count: 0 };
        
        for (let offset = 1; offset <= 12; offset++) {
          const responses = [];
          for (const idx of dropIndices) {
            if (idx + offset < targetReturns.length) {
              responses.push(targetReturns[idx + offset]);
            }
          }
          
          if (responses.length >= 20) {
            const avg = responses.reduce((a,b) => a+b, 0) / responses.length;
            const winRate = responses.filter(r => r > 0).length / responses.length * 100;
            
            if (winRate > best.winRate && winRate > 55) {
              best.winRate = winRate;
              best.offset = offset;
              best.avgReturn = avg;
              best.count = responses.length;
            }
          }
        }
        
        if (best.winRate > 60) {
          results.push({
            source, target, threshold,
            events: dropIndices.length,
            bestOffset: best.offset,
            avgReturn: best.avgReturn,
            winRate: best.winRate,
            sample: best.count
          });
        }
      }
    }
  }

  // Sort and display best patterns
  results.sort((a, b) => b.winRate - a.winRate);
  
  console.log('\n🏆 BEST 1H CASCADE PATTERNS (≥30 events):');
  console.log('-'.repeat(85));
  
  for (const r of results.slice(0, 20)) {
    console.log(`\n🎯 ${r.source} drop >${r.threshold}% → ${r.target}`);
    console.log(`   Events: ${r.events} | Day +${r.bestOffset}H | Avg: ${r.avgReturn >= 0 ? '+' : ''}${r.avgReturn.toFixed(2)}% | WR: ${r.winRate.toFixed(0)}% (n=${r.sample})`);
  }

  // Pump fade patterns
  console.log('\n' + '='.repeat(70));
  console.log('📈 UPSIDE FADES (Pump → Reversal)');
  console.log('='.repeat(70));
  
  const pumpResults = [];
  
  for (const source of ['ETH/USD', 'BTC/USD', 'SOL/USD']) {
    const sourceReturns = returns[source];
    
    for (const target of ASSETS) {
      if (source === target) continue;
      
      const targetReturns = returns[target];
      
      for (const threshold of [1.5, 2, 2.5, 3, 4]) {
        const pumpIndices = [];
        for (let i = 1; i < sourceReturns.length; i++) {
          if (sourceReturns[i] > threshold) {
            pumpIndices.push(i);
          }
        }
        
        if (pumpIndices.length < 30) continue;
        
        for (let offset = 1; offset <= 6; offset++) {
          const responses = [];
          for (const idx of pumpIndices) {
            if (idx + offset < targetReturns.length) {
              responses.push(targetReturns[idx + offset]);
            }
          }
          
          if (responses.length >= 20) {
            const avg = responses.reduce((a,b) => a+b, 0) / responses.length;
            const winRateDown = responses.filter(r => r < 0).length / responses.length * 100;
            
            if (avg < -0.1 && winRateDown > 60) {
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
  
  console.log('\n🏆 BEST 1H PUMP FADE PATTERNS (≥20 events):');
  console.log('-'.repeat(85));
  
  for (const r of pumpResults.slice(0, 15)) {
    console.log(`\n🎯 ${r.source} pump >${r.threshold}% → ${r.target} fades`);
    console.log(`   Events: ${r.events} | +${r.offset}H | Avg: ${r.avgReturn >= 0 ? '+' : ''}${r.avgReturn.toFixed(2)}% | WR (down): ${r.winRateDown.toFixed(0)}%`);
  }

  // ETH crash → XRP bounce detailed
  console.log('\n' + '='.repeat(70));
  console.log('🔍 DETAILED: ETH Crash → XRP Bounce (1H)');
  console.log('='.repeat(70));
  
  const ethReturns = returns['ETH/USD'];
  const xrpReturns = returns['XRP/USD'];
  
  for (const threshold of [1.5, 2, 2.5, 3]) {
    const dropIndices = [];
    for (let i = 1; i < ethReturns.length; i++) {
      if (ethReturns[i] < -threshold) {
        dropIndices.push(i);
      }
    }
    
    if (dropIndices.length < 20) continue;
    
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
        console.log(`   +${offset}H: ${up}${avg.toFixed(2)}% (${winRate.toFixed(0)}% WR) | n=${responses.length}`);
      }
    }
  }

  // BTC crash → XRP bounce
  console.log('\n' + '='.repeat(70));
  console.log('🔍 DETAILED: BTC Crash → XRP Bounce (1H)');
  console.log('='.repeat(70));
  
  const btcReturns = returns['BTC/USD'];
  
  for (const threshold of [1, 1.5, 2]) {
    const dropIndices = [];
    for (let i = 1; i < btcReturns.length; i++) {
      if (btcReturns[i] < -threshold) {
        dropIndices.push(i);
      }
    }
    
    if (dropIndices.length < 30) continue;
    
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
        console.log(`   +${offset}H: ${up}${avg.toFixed(2)}% (${winRate.toFixed(0)}% WR) | n=${responses.length}`);
      }
    }
  }

  // Best performing single pattern summary
  console.log('\n' + '='.repeat(70));
  console.log('🏆 TOP 5 DEPLOYABLE 1H STRATEGIES');
  console.log('='.repeat(70));
  
  const topStrategies = results.slice(0, 5);
  topStrategies.forEach((r, i) => {
    console.log(`\n${i+1}. ${r.source} drop >${r.threshold}% → BUY ${r.target}`);
    console.log(`   Entry: ${r.bestOffset} hours after drop`);
    console.log(`   Expected return: +${r.avgReturn.toFixed(2)}%`);
    console.log(`   Win rate: ${r.winRate.toFixed(0)}% (${r.sample} trades)`);
    console.log(`   Stop loss: -${(r.avgReturn * 0.8).toFixed(2)}%`);
    console.log(`   Take profit: +${(r.avgReturn * 1.5).toFixed(2)}%`);
  });

  console.log('\n' + '='.repeat(70));
  console.log('✅ 1H Cascade Analysis Complete');
  console.log('='.repeat(70));
}

main().catch(console.error);
