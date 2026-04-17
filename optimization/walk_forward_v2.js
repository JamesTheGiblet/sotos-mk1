#!/usr/bin/env node
'use strict';

const RuleEngine = require('../rules/engine');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

class WalkForwardValidatorV2 {
  constructor(config = {}) {
    this.engine = new RuleEngine();
    this.results = [];
    
    // Realistic trading costs
    this.costs = {
      makerFee: config.makerFee || 0.001,      // 0.1% maker fee
      takerFee: config.takerFee || 0.001,      // 0.1% taker fee
      slippage: config.slippage || 0.0005,     // 0.05% slippage
      get totalPerTrade() {
        return (this.makerFee + this.slippage) * 2; // Entry + exit
      }
    };
  }

  async getCandles(pair = 'BTC/USD', interval = '1D') {
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

  // Backtest WITH transaction costs
  backtestWithCosts(candles, strategy, initialCapital = 100) {
    let capital = initialCapital;
    let position = null;
    let trades = [];
    let consecutiveRed = 0;
    
    const costPerTrade = this.costs.totalPerTrade;
    
    for (let i = 30; i < candles.length; i++) {
      // Update indicators
      if (candles[i].close < candles[i].open) {
        consecutiveRed++;
      } else {
        consecutiveRed = 0;
      }
      
      // Check entry
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
          // Apply transaction cost on entry
          capital = capital * (1 - costPerTrade);
        }
      } 
      // Check exit
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
          
          // Apply transaction cost on exit
          const netPnl = grossPnl * (1 - costPerTrade);
          const netPnlPct = (netPnl / position.size) * 100;
          
          capital += netPnl;
          
          trades.push({
            entryPrice: position.entryPrice,
            exitPrice: exitPrice,
            grossPnlPct: grossPnlPct,
            netPnlPct: netPnlPct,
            netPnl: netPnl,
            win: netPnl > 0,
            reason: reason,
            holdDays: holdDays,
            cost: position.size * costPerTrade * 2  // Total cost paid
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
    
    // EXPECTANCY: The most important metric
    // (winRate × avgWin) - (lossRate × avgLoss)
    const expectancy = (winRate / 100 * avgWin) - (lossRate * Math.abs(avgLoss));
    const totalCosts = trades.reduce((s, t) => s + t.cost, 0);
    
    // Profit factor: gross profit / gross loss
    const grossProfit = trades.filter(t => t.win).reduce((s, t) => s + t.grossPnlPct, 0);
    const grossLoss = Math.abs(trades.filter(t => !t.win).reduce((s, t) => s + t.grossPnlPct, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 999;
    
    return {
      trades: trades.length,
      wins,
      losses,
      winRate,
      totalReturn,
      avgWin,
      avgLoss,
      expectancy,
      profitFactor,
      totalCosts,
      finalCapital: capital,
      startCapital: initialCapital
    };
  }

  evaluateEntry(candles, i, strategy, consecutiveRed) {
    // Simplified entry evaluation for the walk-forward
    // This mirrors the rule engine logic
    const conditions = strategy.entryRules.conditions;
    
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
      // Add other indicators as needed
    }
    
    return true;
  }

  generateRandomStrategy() {
    const conditions = ['consecutive', 'change'];
    const numConditions = Math.floor(Math.random() * 2) + 1;
    
    const strategy = {
      name: `wf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      direction: 'long',
      entryRules: {
        type: 'and',
        conditions: []
      },
      params: {
        targetPct: [0.5, 1, 1.5, 2][Math.floor(Math.random() * 4)],
        stopPct: [0.3, 0.5, 0.75, 1][Math.floor(Math.random() * 4)],
        maxHoldDays: [3, 5, 7, 10][Math.floor(Math.random() * 4)]
      }
    };

    if (strategy.params.stopPct >= strategy.params.targetPct) {
      strategy.params.stopPct = strategy.params.targetPct * 0.7;
    }

    for (let i = 0; i < numConditions; i++) {
      const type = conditions[Math.floor(Math.random() * conditions.length)];
      if (type === 'consecutive') {
        strategy.entryRules.conditions.push({
          type: 'consecutive',
          params: {
            count: [2, 3, 4][Math.floor(Math.random() * 3)],
            direction: 'red'
          }
        });
      } else if (type === 'change') {
        strategy.entryRules.conditions.push({
          type: 'change',
          params: {
            periods: [3, 5, 7][Math.floor(Math.random() * 3)],
            compare: '<',
            value: [3, 4, 5, 6][Math.floor(Math.random() * 4)]
          }
        });
      }
    }

    return strategy;
  }

  validateStrategy(strategy, periods) {
    const trainResult = this.backtestWithCosts(periods.train, strategy);
    const testResult = this.backtestWithCosts(periods.test, strategy);
    const validateResult = this.backtestWithCosts(periods.validate, strategy);
    
    // Pass criteria with expectancy > 0
    const passes = (
      trainResult.expectancy > 0.5 &&
      testResult.expectancy > 0.5 &&
      validateResult.expectancy > 0.5 &&
      trainResult.trades >= 8 &&
      testResult.trades >= 5 &&
      validateResult.trades >= 5 &&
      trainResult.totalReturn > 5 &&
      testResult.totalReturn > 0 &&
      validateResult.totalReturn > 0
    );
    
    return {
      strategy,
      passes,
      train: trainResult,
      test: testResult,
      validate: validateResult,
      score: this.calculateScore(trainResult, testResult, validateResult)
    };
  }

  calculateScore(train, test, validate) {
    // Score based on expectancy and consistency
    const avgExpectancy = (train.expectancy + test.expectancy + validate.expectancy) / 3;
    const minExpectancy = Math.min(train.expectancy, test.expectancy, validate.expectancy);
    const avgProfitFactor = (train.profitFactor + test.profitFactor + validate.profitFactor) / 3;
    
    return avgExpectancy * 10 + minExpectancy * 5 + avgProfitFactor * 2;
  }

  async discover(iterations = 300) {
    console.log('\n' + '═'.repeat(60));
    console.log('🔬 WALK-FORWARD VALIDATION v2');
    console.log('═'.repeat(60));
    console.log(`Transaction costs: ${(this.costs.totalPerTrade * 100).toFixed(1)}% per trade (entry + exit)`);
    console.log(`Pass criteria: Expectancy > 0.5 on ALL periods\n`);

    const allCandles = await this.getCandles('BTC/USD', '1D');
    const periods = this.splitData(allCandles);
    
    const trainStart = new Date(periods.train[0].timestamp * 1000).toISOString().split('T')[0];
    const trainEnd = new Date(periods.train[periods.train.length-1].timestamp * 1000).toISOString().split('T')[0];
    const testStart = new Date(periods.test[0].timestamp * 1000).toISOString().split('T')[0];
    const testEnd = new Date(periods.test[periods.test.length-1].timestamp * 1000).toISOString().split('T')[0];
    const validateStart = new Date(periods.validate[0].timestamp * 1000).toISOString().split('T')[0];
    const validateEnd = new Date(periods.validate[periods.validate.length-1].timestamp * 1000).toISOString().split('T')[0];
    
    console.log('Period splits:');
    console.log(`  TRAIN:    ${trainStart} → ${trainEnd} (${periods.train.length} candles)`);
    console.log(`  TEST:     ${testStart} → ${testEnd} (${periods.test.length} candles)`);
    console.log(`  VALIDATE: ${validateStart} → ${validateEnd} (${periods.validate.length} candles)\n`);
    
    const validatedStrategies = [];
    
    // Test known strategies first
    console.log('Testing known strategies:');
    console.log('─'.repeat(40));
    
    const knownStrategies = [
      { name: '4 red days', params: { targetPct: 1, stopPct: 0.75, maxHoldDays: 5 }, entryRules: { conditions: [{ type: 'consecutive', params: { count: 4, direction: 'red' } }] } },
      { name: '4 red + 0.5% target', params: { targetPct: 0.5, stopPct: 0.4, maxHoldDays: 5 }, entryRules: { conditions: [{ type: 'consecutive', params: { count: 4, direction: 'red' } }] } },
      { name: '2 red days', params: { targetPct: 1, stopPct: 0.75, maxHoldDays: 5 }, entryRules: { conditions: [{ type: 'consecutive', params: { count: 2, direction: 'red' } }] } },
      { name: '3 red days', params: { targetPct: 1, stopPct: 0.75, maxHoldDays: 5 }, entryRules: { conditions: [{ type: 'consecutive', params: { count: 3, direction: 'red' } }] } }
    ];
    
    for (const known of knownStrategies) {
      const validation = this.validateStrategy(known, periods);
      const status = validation.passes ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${known.name}: Train:${validation.train.expectancy.toFixed(2)} Test:${validation.test.expectancy.toFixed(2)} Val:${validation.validate.expectancy.toFixed(2)}`);
      if (validation.passes) validatedStrategies.push(validation);
    }
    
    console.log('\nSearching random strategies...\n');
    
    for (let i = 0; i < iterations; i++) {
      const strategy = this.generateRandomStrategy();
      const validation = this.validateStrategy(strategy, periods);
      
      if (validation.passes) {
        validatedStrategies.push(validation);
        
        console.log(`\n✅ PASSED: ${strategy.name}`);
        console.log(`   Train:   ${validation.train.trades} trades | ${validation.train.winRate.toFixed(1)}% WR | E:${validation.train.expectancy.toFixed(2)} | R:${validation.train.totalReturn.toFixed(1)}%`);
        console.log(`   Test:    ${validation.test.trades} trades | ${validation.test.winRate.toFixed(1)}% WR | E:${validation.test.expectancy.toFixed(2)} | R:${validation.test.totalReturn.toFixed(1)}%`);
        console.log(`   Validate:${validation.validate.trades} trades | ${validation.validate.winRate.toFixed(1)}% WR | E:${validation.validate.expectancy.toFixed(2)} | R:${validation.validate.totalReturn.toFixed(1)}%`);
        console.log(`   Costs paid: $${validation.train.totalCosts.toFixed(2)} + $${validation.test.totalCosts.toFixed(2)} + $${validation.validate.totalCosts.toFixed(2)}`);
      }
      
      if ((i + 1) % 50 === 0) {
        console.log(`  Searched ${i + 1}/${iterations}... Found ${validatedStrategies.length} validated strategies`);
      }
    }
    
    console.log(`\n\n════════════════════════════════════════════════════════════`);
    console.log(`📊 WALK-FORWARD VALIDATION v2 COMPLETE`);
    console.log('════════════════════════════════════════════════════════════');
    console.log(`Found ${validatedStrategies.length} strategies that pass with expectancy > 0.5`);
    
    validatedStrategies.sort((a, b) => b.score - a.score);
    
    if (validatedStrategies.length > 0) {
      console.log('\n🏆 TOP VALIDATED STRATEGIES (With transaction costs):');
      console.log('─'.repeat(80));
      
      validatedStrategies.slice(0, 10).forEach((v, idx) => {
        console.log(`\n${idx + 1}. ${v.strategy.name} | Score: ${v.score.toFixed(1)}`);
        console.log(`   Train:   ${v.train.trades} trades | ${v.train.winRate.toFixed(1)}% WR | E:${v.train.expectancy.toFixed(2)} | ${v.train.totalReturn.toFixed(1)}%`);
        console.log(`   Test:    ${v.test.trades} trades | ${v.test.winRate.toFixed(1)}% WR | E:${v.test.expectancy.toFixed(2)} | ${v.test.totalReturn.toFixed(1)}%`);
        console.log(`   Validate:${v.validate.trades} trades | ${v.validate.winRate.toFixed(1)}% WR | E:${v.validate.expectancy.toFixed(2)} | ${v.validate.totalReturn.toFixed(1)}%`);
        console.log(`   Rules: ${v.strategy.entryRules.conditions.map(c => `${c.type}(${c.params.count || c.params.periods})`).join(' + ')}`);
      });
      
      const outputPath = path.join(__dirname, '../strategies/walk_forward_validated_v2.json');
      fs.writeFileSync(outputPath, JSON.stringify(validatedStrategies, null, 2));
      console.log(`\n✅ Validated strategies saved to ${outputPath}`);
    }
    
    return validatedStrategies;
  }
}

const validator = new WalkForwardValidatorV2();
validator.discover(300).catch(console.error);
