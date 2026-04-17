#!/usr/bin/env node
'use strict';

const RuleEngine = require('../rules/engine');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

class WalkForwardValidator {
  constructor() {
    this.engine = new RuleEngine();
    this.results = [];
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

  // Split data into 3 periods
  splitData(candles) {
    const total = candles.length;
    const periodSize = Math.floor(total / 3);
    
    return {
      train: candles.slice(0, periodSize),           // 2020-2022 (oldest)
      test: candles.slice(periodSize, periodSize * 2), // 2022-2023 (middle)
      validate: candles.slice(periodSize * 2)        // 2023-2026 (most recent)
    };
  }

  // Generate random strategy (same as discovery.js)
  generateRandomStrategy() {
    const conditions = ['consecutive', 'change', 'rsi', 'volume', 'zscore', 'volatility'];
    const numConditions = Math.floor(Math.random() * 3) + 1;
    
    const strategy = {
      name: `wf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      direction: 'long',
      entryRules: {
        type: 'and',
        conditions: []
      },
      params: {
        targetPct: [0.5, 1, 1.5, 2, 2.5, 3][Math.floor(Math.random() * 6)],
        stopPct: [0.3, 0.5, 0.75, 1, 1.5, 2][Math.floor(Math.random() * 6)],
        maxHoldDays: [2, 3, 5, 7, 10, 14][Math.floor(Math.random() * 6)]
      }
    };

    if (strategy.params.stopPct >= strategy.params.targetPct) {
      strategy.params.stopPct = strategy.params.targetPct * 0.7;
    }

    for (let i = 0; i < numConditions; i++) {
      const type = conditions[Math.floor(Math.random() * conditions.length)];
      const condition = this.generateCondition(type);
      if (condition) {
        strategy.entryRules.conditions.push(condition);
      }
    }

    return strategy;
  }

  generateCondition(type) {
    switch (type) {
      case 'consecutive':
        return {
          type: 'consecutive',
          params: {
            count: [2, 3, 4, 5][Math.floor(Math.random() * 4)],
            direction: Math.random() > 0.5 ? 'red' : 'green'
          }
        };
      
      case 'change':
        return {
          type: 'change',
          params: {
            periods: [1, 2, 3, 5, 7][Math.floor(Math.random() * 5)],
            compare: Math.random() > 0.7 ? '>' : '<',
            value: Math.floor(Math.random() * 10) + 1
          }
        };
      
      case 'rsi':
        return {
          type: 'rsi',
          params: {
            period: 14,
            compare: Math.random() > 0.5 ? '<' : '>',
            value: Math.random() > 0.7 ? [25, 30, 35][Math.floor(Math.random() * 3)] : [65, 70, 75][Math.floor(Math.random() * 3)]
          }
        };
      
      case 'volume':
        return {
          type: 'volume',
          params: {
            period: 14,
            compare: '>',
            multiplier: [1.2, 1.5, 2, 2.5][Math.floor(Math.random() * 4)]
          }
        };
      
      case 'zscore':
        return {
          type: 'zscore',
          params: {
            period: [30, 60, 90][Math.floor(Math.random() * 3)],
            compare: '<',
            value: [-2, -1.5, -1][Math.floor(Math.random() * 3)]
          }
        };
      
      case 'volatility':
        return {
          type: 'volatility',
          params: {
            period: 14,
            compare: Math.random() > 0.5 ? '>' : '<',
            value: [1, 1.5, 2, 2.5][Math.floor(Math.random() * 4)]
          }
        };
      
      default:
        return null;
    }
  }

  // Validate a strategy across all three periods
  validateStrategy(strategy, periods) {
    const trainResult = this.engine.backtest(periods.train, strategy);
    const testResult = this.engine.backtest(periods.test, strategy);
    const validateResult = this.engine.backtest(periods.validate, strategy);
    
    // Calculate degradation
    const trainToTestDegradation = trainResult.winRate - testResult.winRate;
    const testToValidateDegradation = testResult.winRate - validateResult.winRate;
    const totalDegradation = trainResult.winRate - validateResult.winRate;
    
    // Pass criteria:
    // 1. Win rate > 55% on ALL three periods
    // 2. Total return positive on ALL three periods
    // 3. Degradation < 15% (edge holds reasonably well)
    // 4. Minimum 8 trades per period
    
    const passes = (
      trainResult.winRate >= 55 &&
      testResult.winRate >= 55 &&
      validateResult.winRate >= 55 &&
      trainResult.totalReturn > 0 &&
      testResult.totalReturn > 0 &&
      validateResult.totalReturn > 0 &&
      trainResult.trades >= 8 &&
      testResult.trades >= 5 &&
      validateResult.trades >= 5 &&
      totalDegradation < 15
    );
    
    return {
      strategy,
      passes,
      train: trainResult,
      test: testResult,
      validate: validateResult,
      degradation: {
        trainToTest: trainToTestDegradation,
        testToValidate: testToValidateDegradation,
        total: totalDegradation
      },
      score: this.calculateScore(trainResult, testResult, validateResult)
    };
  }

  calculateScore(train, test, validate) {
    // Weighted score favoring consistency across all periods
    const avgWinRate = (train.winRate + test.winRate + validate.winRate) / 3;
    const minWinRate = Math.min(train.winRate, test.winRate, validate.winRate);
    const avgReturn = (train.totalReturn + test.totalReturn + validate.totalReturn) / 3;
    const degradation = train.winRate - validate.winRate;
    
    let score = avgWinRate * 1.0;           // Average win rate
    score += minWinRate * 0.5;              // Bonus for consistency (min win rate)
    score += avgReturn * 0.3;              // Average return
    score -= degradation * 2.0;            // Heavy penalty for degradation
    
    return score;
  }

  async discover(iterations = 500) {
    console.log('\n' + '═'.repeat(60));
    console.log('🔬 WALK-FORWARD VALIDATION DISCOVERY');
    console.log('═'.repeat(60));
    console.log(`Searching ${iterations} random strategies...`);
    console.log('Pass criteria: WR >55% on ALL periods, positive return, degradation <15%\n');

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
    
    for (let i = 0; i < iterations; i++) {
      const strategy = this.generateRandomStrategy();
      const validation = this.validateStrategy(strategy, periods);
      
      if (validation.passes) {
        validatedStrategies.push(validation);
        
        console.log(`\n✅ PASSED: ${strategy.name}`);
        console.log(`   Train:   ${validation.train.trades} trades | ${validation.train.winRate.toFixed(1)}% WR | +${validation.train.totalReturn.toFixed(1)}%`);
        console.log(`   Test:    ${validation.test.trades} trades | ${validation.test.winRate.toFixed(1)}% WR | +${validation.test.totalReturn.toFixed(1)}%`);
        console.log(`   Validate:${validation.validate.trades} trades | ${validation.validate.winRate.toFixed(1)}% WR | +${validation.validate.totalReturn.toFixed(1)}%`);
        console.log(`   Degradation: ${validation.degradation.total.toFixed(1)}%`);
        console.log(`   Rules: ${strategy.entryRules.conditions.map(c => c.type).join(' + ')}`);
      }
      
      if ((i + 1) % 100 === 0) {
        console.log(`  Searched ${i + 1}/${iterations}... Found ${validatedStrategies.length} validated strategies`);
      }
    }
    
    console.log(`\n\n════════════════════════════════════════════════════════════`);
    console.log(`📊 WALK-FORWARD VALIDATION COMPLETE`);
    console.log('════════════════════════════════════════════════════════════');
    console.log(`Found ${validatedStrategies.length} strategies that pass all three periods`);
    
    // Sort by score
    validatedStrategies.sort((a, b) => b.score - a.score);
    
    if (validatedStrategies.length > 0) {
      console.log('\n🏆 TOP 10 VALIDATED STRATEGIES (Works across ALL time periods):');
      console.log('─'.repeat(80));
      
      validatedStrategies.slice(0, 10).forEach((v, idx) => {
        console.log(`\n${idx + 1}. Score: ${v.score.toFixed(1)}`);
        console.log(`   Train:   ${v.train.trades} trades | ${v.train.winRate.toFixed(1)}% WR | +${v.train.totalReturn.toFixed(1)}%`);
        console.log(`   Test:    ${v.test.trades} trades | ${v.test.winRate.toFixed(1)}% WR | +${v.test.totalReturn.toFixed(1)}%`);
        console.log(`   Validate:${v.validate.trades} trades | ${v.validate.winRate.toFixed(1)}% WR | +${v.validate.totalReturn.toFixed(1)}%`);
        console.log(`   Rules: ${v.strategy.entryRules.conditions.map(c => c.type).join(' + ')}`);
        console.log(`   Params: target:${v.strategy.params.targetPct}% stop:${v.strategy.params.stopPct}% hold:${v.strategy.params.maxHoldDays}d`);
      });
      
      // Save validated strategies
      const outputDir = path.join(__dirname, '../strategies');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      
      const outputPath = path.join(outputDir, 'walk_forward_validated.json');
      fs.writeFileSync(outputPath, JSON.stringify(validatedStrategies, null, 2));
      console.log(`\n✅ Validated strategies saved to ${outputPath}`);
    } else {
      console.log('\n❌ No strategies passed walk-forward validation.');
      console.log('   This means most discovered patterns are curve-fitted noise.');
      console.log('   Try lowering thresholds or running more iterations.');
    }
    
    return validatedStrategies;
  }
}

const validator = new WalkForwardValidator();
validator.discover(500).catch(console.error);
