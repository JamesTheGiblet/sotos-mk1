#!/usr/bin/env node
'use strict';

const RuleEngine = require('../rules/engine');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

class WalkForwardValidatorXRP {
  constructor(config = {}) {
    this.engine = new RuleEngine();
    this.results = [];
    
    this.costs = {
      makerFee: config.makerFee || 0.001,
      takerFee: config.takerFee || 0.001,
      slippage: config.slippage || 0.0005,
      get totalPerTrade() {
        return (this.makerFee + this.slippage) * 2;
      }
    };
  }

  async getCandles(pair = 'XRP/USD', interval = '1D') {
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(dbBuffer);
    
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = ?
       ORDER BY timestamp ASC`,
      [pair, interval]
    );
    
    db.close();
    
    if (!result.length) return [];
    
    const { columns, values } = result[0];
    return values.map(row => {
      const candle = {};
      columns.forEach((col, i) => candle[col] = row[i]);
      return candle;
    });
  }

  splitData(candles) {
    const total = candles.length;
    const periodSize = Math.floor(total / 3);
    
    return {
      train: candles.slice(0, periodSize),
      test: candles.slice(periodSize, periodSize * 2),
      validate: candles.slice(periodSize * 2)
    };
  }

  backtestWithCosts(candles, strategy, initialCapital = 100) {
    let capital = initialCapital;
    let position = null;
    let trades = [];
    let consecutiveRed = 0;
    const costPerTrade = this.costs.totalPerTrade;
    
    for (let i = 30; i < candles.length; i++) {
      if (candles[i].close < candles[i].open) {
        consecutiveRed++;
      } else {
        consecutiveRed = 0;
      }
      
      if (!position) {
        const shouldEnter = this.evaluateEntry(candles, i, strategy, consecutiveRed);
        if (shouldEnter) {
          const entryPrice = candles[i].close;
          position = {
            entryPrice: entryPrice,
            entryIdx: i,
            entryDate: candles[i].timestamp,
            size: capital
          };
          capital = capital * (1 - costPerTrade);
        }
      } 
      else if (position) {
        const pnlPct = (candles[i].close - position.entryPrice) / position.entryPrice * 100;
        const holdDays = Math.floor((candles[i].timestamp - position.entryDate) / 86400);
        
        let exit = false;
        let reason = '';
        
        if (pnlPct >= strategy.params.targetPct) {
          exit = true;
          reason = 'take_profit';
        } else if (pnlPct <= -strategy.params.stopPct) {
          exit = true;
          reason = 'stop_loss';
        } else if (holdDays >= strategy.params.maxHoldDays) {
          exit = true;
          reason = 'timeout';
        }
        
        if (exit) {
          const exitPrice = candles[i].close;
          const grossPnlPct = pnlPct;
          const grossPnl = position.size * (grossPnlPct / 100);
          const netPnl = grossPnl * (1 - costPerTrade);
          const netPnlPct = (netPnl / position.size) * 100;
          
          capital += netPnl;
          
          trades.push({
            entryPrice: position.entryPrice,
            exitPrice: exitPrice,
            grossPnlPct: grossPnlPct,
            netPnlPct: netPnlPct,
            win: netPnl > 0,
            reason: reason,
            holdDays: holdDays,
            cost: position.size * costPerTrade * 2
          });
          
          position = null;
          consecutiveRed = 0;
        }
      }
    }
    
    const wins = trades.filter(t => t.win).length;
    const losses = trades.filter(t => !t.win).length;
    const winRate = trades.length ? (wins / trades.length * 100) : 0;
    const totalReturn = ((capital - initialCapital) / initialCapital * 100);
    const avgWin = wins ? trades.filter(t => t.win).reduce((s, t) => s + t.netPnlPct, 0) / wins : 0;
    const avgLoss = losses ? trades.filter(t => !t.win).reduce((s, t) => s + t.netPnlPct, 0) / losses : 0;
    const lossRate = losses / trades.length;
    
    const expectancy = (winRate / 100 * avgWin) - (lossRate * Math.abs(avgLoss));
    const totalCosts = trades.reduce((s, t) => s + t.cost, 0);
    
    return {
      trades: trades.length,
      wins,
      losses,
      winRate,
      totalReturn,
      avgWin,
      avgLoss,
      expectancy,
      totalCosts,
      finalCapital: capital
    };
  }

  evaluateEntry(candles, i, strategy, consecutiveRed) {
    const conditions = strategy.entryRules.conditions;
    if (!conditions || conditions.length === 0) return true;
    
    for (const condition of conditions) {
      if (condition.type === 'consecutive') {
        const required = condition.params.count;
        if (consecutiveRed < required) return false;
      }
      if (condition.type === 'change') {
        const periods = condition.params.periods;
        const compare = condition.params.compare;
        const value = condition.params.value;
        if (i < periods) return false;
        const changePct = (candles[i].close - candles[i - periods].close) / candles[i - periods].close * 100;
        if (compare === '<' && changePct > -value) return false;
        if (compare === '>' && changePct < value) return false;
      }
    }
    return true;
  }

  async testStrategy(strategy, name) {
    console.log(`\n📊 Testing: ${name}`);
    console.log('─'.repeat(50));
    
    const candles = await this.getCandles('XRP/USD', '1D');
    if (candles.length === 0) {
      console.log('❌ No XRP data found');
      return null;
    }
    
    const periods = this.splitData(candles);
    
    const trainResult = this.backtestWithCosts(periods.train, strategy);
    const testResult = this.backtestWithCosts(periods.test, strategy);
    const validateResult = this.backtestWithCosts(periods.validate, strategy);
    
    console.log(`XRP candles: ${candles.length}`);
    console.log(`Train (${periods.train.length} candles): ${trainResult.trades} trades | ${trainResult.winRate.toFixed(1)}% WR | E:${trainResult.expectancy.toFixed(2)} | R:${trainResult.totalReturn.toFixed(1)}%`);
    console.log(`Test  (${periods.test.length} candles): ${testResult.trades} trades | ${testResult.winRate.toFixed(1)}% WR | E:${testResult.expectancy.toFixed(2)} | R:${testResult.totalReturn.toFixed(1)}%`);
    console.log(`Val   (${periods.validate.length} candles): ${validateResult.trades} trades | ${validateResult.winRate.toFixed(1)}% WR | E:${validateResult.expectancy.toFixed(2)} | R:${validateResult.totalReturn.toFixed(1)}%`);
    
    const allPositive = trainResult.expectancy > 0 && testResult.expectancy > 0 && validateResult.expectancy > 0;
    console.log(`\n${allPositive ? '✅' : '❌'} Verdict: ${allPositive ? 'Strategy holds on XRP' : 'Strategy fails on XRP'}`);
    
    return { trainResult, testResult, validateResult, allPositive };
  }

  async run() {
    console.log('\n' + '═'.repeat(60));
    console.log('🔬 XRP WALK-FORWARD VALIDATION');
    console.log('═'.repeat(60));
    console.log(`Transaction costs: ${(this.costs.totalPerTrade * 100).toFixed(1)}% per trade\n`);
    
    // Load the winning BTC strategy
    const btcWinningStrategy = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../strategies/walk_forward_validated_v2.json'), 'utf8'
    ))[0].strategy;
    
    console.log('Testing BTC winning strategy on XRP:');
    console.log(`  Rules: ${btcWinningStrategy.entryRules.conditions.map(c => `${c.type}(${JSON.stringify(c.params)})`).join(' + ')}`);
    console.log(`  Params: target:${btcWinningStrategy.params.targetPct}% stop:${btcWinningStrategy.params.stopPct}% hold:${btcWinningStrategy.params.maxHoldDays}d`);
    
    await this.testStrategy(btcWinningStrategy, 'BTC Winning Strategy on XRP');
    
    // Also test 4 red days on XRP for comparison
    const fourRedStrategy = {
      params: { targetPct: 1, stopPct: 0.75, maxHoldDays: 5 },
      entryRules: { conditions: [{ type: 'consecutive', params: { count: 4, direction: 'red' } }] }
    };
    
    console.log('\n' + '═'.repeat(60));
    await this.testStrategy(fourRedStrategy, '4 Red Days on XRP');
  }
}

const validator = new WalkForwardValidatorXRP();
validator.run().catch(console.error);
