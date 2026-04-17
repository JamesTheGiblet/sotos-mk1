#!/usr/bin/env node
'use strict';

const RuleEngine = require('../rules/engine');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class StrategyOptimizer {
  constructor(dbPath) {
    this.engine = new RuleEngine();
    this.dbPath = dbPath;
    this.db = null;
    this.results = [];
  }

  async init() {
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(this.dbPath);
    this.db = new SQL.Database(dbBuffer);
  }

  getCandles(pair = 'BTC/USD', interval = '1D') {
    const result = this.db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = ?
       ORDER BY timestamp ASC`,
      [pair, interval]
    );
    
    if (!result.length) return [];
    
    const { columns, values } = result[0];
    return values.map(row => {
      const candle = {};
      columns.forEach((col, i) => candle[col] = row[i]);
      return candle;
    });
  }

  gridSearch(baseStrategy, paramRanges, candles) {
    const results = [];
    const paramNames = Object.keys(paramRanges);
    const totalCombos = paramRanges[paramNames[0]].length * 
                        (paramRanges[paramNames[1]]?.length || 1) *
                        (paramRanges[paramNames[2]]?.length || 1);

    let comboCount = 0;

    const recursiveSearch = (currentParams, depth) => {
      if (depth === paramNames.length) {
        comboCount++;
        const strategy = JSON.parse(JSON.stringify(baseStrategy));
        
        for (const [key, value] of Object.entries(currentParams)) {
          if (key.includes('.')) {
            const parts = key.split('.');
            let obj = strategy;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!obj[parts[i]]) obj[parts[i]] = {};
              obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
          } else if (strategy.params) {
            strategy.params[key] = value;
          } else if (strategy.entryRules?.params) {
            strategy.entryRules.params[key] = value;
          }
        }

        const result = this.engine.backtest(candles, strategy);
        const score = this.calculateScore(result);
        
        results.push({
          params: { ...currentParams },
          result,
          score
        });

        if (comboCount % 50 === 0) {
          process.stdout.write(`\r  Tested ${comboCount}/${totalCombos} combos...`);
        }
        return;
      }

      const paramName = paramNames[depth];
      for (const value of paramRanges[paramName]) {
        recursiveSearch({ ...currentParams, [paramName]: value }, depth + 1);
      }
    };

    console.log(`\nGrid search: ${totalCombos} combinations`);
    recursiveSearch({}, 0);
    console.log(`\n  Complete. Found ${results.length} results`);

    return results.sort((a, b) => b.score - a.score);
  }

  calculateScore(result) {
    if (!result.isValid) return -999;
    
    let score = 0;
    score += result.winRate * 1.0;
    score += result.totalReturn * 0.5;
    score += result.sharpe * 10;
    score -= result.avgLoss * 0.2;
    
    if (result.trades >= 20) score += 10;
    if (result.trades >= 10) score += 5;
    
    return score;
  }

  async optimizeStrategy(strategyName, paramRanges) {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`🔧 Optimizing: ${strategyName}`);
    console.log('════════════════════════════════════════════════════════════\n');

    await this.init();
    
    const strategies = JSON.parse(fs.readFileSync(path.join(__dirname, '../rules/strategies.json'), 'utf8'));
    const baseStrategy = strategies[strategyName];
    
    if (!baseStrategy) {
      console.error(`Strategy "${strategyName}" not found`);
      return null;
    }

    const candles = this.getCandles(baseStrategy.asset || 'BTC/USD', '1D');
    console.log(`Candles: ${candles.length}`);

    const results = this.gridSearch(baseStrategy, paramRanges, candles);

    console.log('\n\nTop 10 configurations:');
    console.log('─'.repeat(80));
    
    results.slice(0, 10).forEach((r, idx) => {
      console.log(`\n${idx + 1}. Score: ${r.score.toFixed(1)} | Trades: ${r.result.trades} | WR: ${r.result.winRate.toFixed(1)}% | Return: ${r.result.totalReturn.toFixed(1)}%`);
      console.log(`   Params: ${JSON.stringify(r.params)}`);
    });

    const best = results[0];
    const optimizedStrategy = {
      ...baseStrategy,
      optimizedParams: best.params,
      backtestResult: best.result,
      optimizationDate: new Date().toISOString()
    };

    const outputDir = path.join(__dirname, '../strategies');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    fs.writeFileSync(
      path.join(outputDir, `${strategyName}_optimized.json`),
      JSON.stringify(optimizedStrategy, null, 2)
    );

    console.log(`\n✅ Optimized strategy saved to strategies/${strategyName}_optimized.json`);

    return best;
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = StrategyOptimizer;
