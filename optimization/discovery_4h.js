#!/usr/bin/env node
'use strict';

const RuleEngine = require('../rules/engine');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class StrategyDiscovery {
  constructor(dbPath, interval = '4H') {
    this.engine = new RuleEngine();
    this.dbPath = dbPath;
    this.interval = interval;
    this.db = null;
    this.discovered = [];
  }

  async init() {
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(this.dbPath);
    this.db = new SQL.Database(dbBuffer);
  }

  getCandles(pair = 'BTC/USD') {
    const result = this.db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = ?
       ORDER BY timestamp ASC`,
      [pair, this.interval]
    );
    
    if (!result.length) return [];
    
    const { columns, values } = result[0];
    return values.map(row => {
      const candle = {};
      columns.forEach((col, i) => candle[col] = row[i]);
      return candle;
    });
  }

  generateRandomStrategy() {
    const conditions = ['consecutive', 'change', 'rsi', 'volume', 'zscore', 'volatility'];
    const numConditions = Math.floor(Math.random() * 3) + 1;
    
    // Adjust params for shorter timeframes
    const targetOptions = this.interval === '1H' ? [0.3, 0.5, 0.8, 1, 1.2] : [1, 1.5, 2, 2.5, 3];
    const stopOptions = this.interval === '1H' ? [0.2, 0.3, 0.5, 0.7, 1] : [0.5, 1, 1.5, 2, 2.5];
    const holdOptions = this.interval === '1H' ? [2, 3, 4, 6, 8, 12] : [2, 3, 5, 7, 10, 14];
    
    const strategy = {
      name: `discovered_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      direction: 'long',
      entryRules: {
        type: 'and',
        conditions: []
      },
      params: {
        targetPct: targetOptions[Math.floor(Math.random() * targetOptions.length)],
        stopPct: stopOptions[Math.floor(Math.random() * stopOptions.length)],
        maxHoldDays: holdOptions[Math.floor(Math.random() * holdOptions.length)]
      }
    };

    if (strategy.params.stopPct >= strategy.params.targetPct) {
      strategy.params.stopPct = strategy.params.targetPct * 0.75;
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
    // Adjust period ranges for shorter timeframes
    const periodMultiplier = this.interval === '1H' ? 1 : (this.interval === '4H' ? 2 : 4);
    
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
            periods: [1, 2, 3, 4, 6][Math.floor(Math.random() * 5)] * periodMultiplier,
            compare: Math.random() > 0.7 ? '>' : '<',
            value: Math.floor(Math.random() * 8) + (this.interval === '1H' ? 0.5 : 2)
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
            period: Math.max(6, Math.floor(14 / periodMultiplier)),
            compare: '>',
            multiplier: [1.2, 1.5, 2, 2.5][Math.floor(Math.random() * 4)]
          }
        };
      
      case 'zscore':
        return {
          type: 'zscore',
          params: {
            period: [20, 30, 40, 60][Math.floor(Math.random() * 4)],
            compare: '<',
            value: [-2, -1.5, -1, -0.8][Math.floor(Math.random() * 4)]
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

  async discover(minTrades = 10, minWinRate = 52, iterations = 500) {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`🔍 Strategy Discovery Engine — ${this.interval}`);
    console.log('════════════════════════════════════════════════════════════\n');
    console.log(`Target: min ${minTrades} trades, ${minWinRate}% win rate`);
    console.log(`Searching ${iterations} random strategies...\n`);

    await this.init();
    
    const candles = this.getCandles('BTC/USD');
    console.log(`Candles loaded: ${candles.length}\n`);
    
    const validStrategies = [];

    for (let i = 0; i < iterations; i++) {
      const strategy = this.generateRandomStrategy();
      const result = this.engine.backtest(candles, strategy);
      
      if (result.trades >= minTrades && result.winRate >= minWinRate && result.totalReturn > 5) {
        const sharpeBonus = result.sharpe > 0.5 ? '⭐' : '';
        console.log(`\n✅ Found: ${strategy.name}`);
        console.log(`   Trades: ${result.trades} | WR: ${result.winRate.toFixed(1)}% | Return: ${result.totalReturn.toFixed(1)}% | Sharpe: ${result.sharpe.toFixed(2)} ${sharpeBonus}`);
        console.log(`   Rules: ${strategy.entryRules.conditions.map(c => c.type).join(' + ')}`);
        console.log(`   Params: target:${strategy.params.targetPct}% stop:${strategy.params.stopPct}% hold:${strategy.params.maxHoldDays}${this.interval === '1H' ? 'h' : 'd'}`);
        
        validStrategies.push({
          strategy,
          result,
          interval: this.interval,
          discoveryDate: new Date().toISOString()
        });
      }
      
      if ((i + 1) % 50 === 0) {
        console.log(`  Searched ${i + 1}/${iterations}... Found ${validStrategies.length} so far`);
      }
    }

    console.log(`\n\n════════════════════════════════════════════════════════════`);
    console.log(`📊 Discovery Complete — ${this.interval}`);
    console.log('════════════════════════════════════════════════════════════\n');
    console.log(`Found ${validStrategies.length} viable strategies`);

    if (validStrategies.length === 0) {
      console.log('  No strategies met the criteria. Try lowering thresholds.');
      return [];
    }

    validStrategies.sort((a, b) => {
      const scoreA = a.result.winRate * a.result.trades;
      const scoreB = b.result.winRate * b.result.trades;
      return scoreB - scoreA;
    });

    const topStrategies = validStrategies.slice(0, 15);
    
    console.log('\n🏆 Top 15 Discovered Strategies:');
    console.log('─'.repeat(80));
    
    topStrategies.forEach((s, idx) => {
      console.log(`\n${idx + 1}. ${s.strategy.name}`);
      console.log(`   WR: ${s.result.winRate.toFixed(1)}% | Trades: ${s.result.trades} | Return: ${s.result.totalReturn.toFixed(1)}% | Sharpe: ${s.result.sharpe.toFixed(2)}`);
      console.log(`   Entry: ${s.strategy.entryRules.conditions.map(c => `${c.type}(${JSON.stringify(c.params)})`).join(' + ')}`);
      console.log(`   Exit: target:${s.strategy.params.targetPct}% stop:${s.strategy.params.stopPct}% maxHold:${s.strategy.params.maxHoldDays}${this.interval === '1H' ? 'h' : 'd'}`);
    });

    const outputDir = path.join(__dirname, `../strategies/${this.interval}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `discovered_${this.interval}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(validStrategies, null, 2));
    console.log(`\n✅ All ${validStrategies.length} discoveries saved to ${outputPath}`);

    return validStrategies;
  }

  close() {
    if (this.db) this.db.close();
  }
}

const dbPath = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Database not found: ${dbPath}`);
  process.exit(1);
}

const interval = process.argv[2] || '4H';
const discovery = new StrategyDiscovery(dbPath, interval);

discovery.discover(10, 52, 500).then(() => {
  discovery.close();
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
