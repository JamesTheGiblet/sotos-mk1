#!/usr/bin/env node
/**
 * Adaptive Intelligence Platform — Kraken Intelligence
 * Part of the AIP suite of AI-powered developer tools
 * License: MIT
 */

#!/usr/bin/env node
'use strict';

const RuleEngine = require('./rules/engine');
const StrategyOptimizer = require('./optimization/optimizer');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🧠 Kraken Intelligence — Rule-Based Strategy Engine');
  console.log('════════════════════════════════════════════════════════════\n');

  if (!command || command === 'help') {
    console.log('Usage:');
    console.log('  node cli.js list                       List predefined strategies');
    console.log('  node cli.js test <strategy>            Test a specific strategy');
    console.log('  node cli.js compare                    Compare all strategies');
    console.log('\nExamples:');
    console.log('  node cli.js test three_red');
    console.log('  node cli.js compare');
    process.exit(0);
  }

  const engine = new RuleEngine();
  
  // Check if DB exists
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Database not found: ${DB_PATH}`);
    console.error('Run collect.js first to build the database.');
    process.exit(1);
  }

  const strategies = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules/strategies.json'), 'utf8'));

  if (command === 'list') {
    console.log('Predefined Strategies:\n');
    for (const [key, strat] of Object.entries(strategies)) {
      console.log(`  ${key}`);
      console.log(`    ${strat.description || strat.name}`);
      console.log(`    Entry: ${JSON.stringify(strat.entryRules).substring(0, 80)}...`);
      console.log('');
    }
  }

  else if (command === 'test') {
    const strategyName = args[1];
    const strategy = strategies[strategyName];
    if (!strategy) {
      console.error(`Strategy "${strategyName}" not found`);
      console.log('\nAvailable strategies:', Object.keys(strategies).join(', '));
      process.exit(1);
    }

    // Load candles directly from DB using sql.js
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(dbBuffer);
    
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = ?
       ORDER BY timestamp ASC`,
      [strategy.asset || 'BTC/USD', '1D']
    );
    
    db.close();
    
    if (!result.length) {
      console.error(`No candles found for ${strategy.asset || 'BTC/USD'}`);
      process.exit(1);
    }
    
    const { columns, values } = result[0];
    const candles = values.map(row => {
      const candle = {};
      columns.forEach((col, i) => candle[col] = row[i]);
      return candle;
    });
    
    const backtestResult = engine.backtest(candles, strategy);
    
    console.log(`\n📊 Testing: ${strategy.name || strategyName}`);
    console.log('─'.repeat(50));
    console.log(`  Description: ${strategy.description || 'N/A'}`);
    console.log(`\nResults:`);
    console.log(`  Trades:       ${backtestResult.trades}`);
    console.log(`  Win rate:     ${backtestResult.winRate.toFixed(1)}%`);
    console.log(`  Avg P&L:      ${backtestResult.avgPnl >= 0 ? '+' : ''}${backtestResult.avgPnl.toFixed(2)}%`);
    console.log(`  Avg win:      +${backtestResult.avgWin.toFixed(2)}%`);
    console.log(`  Avg loss:     ${backtestResult.avgLoss.toFixed(2)}%`);
    console.log(`  Avg hold:     ${backtestResult.avgHold.toFixed(0)} days`);
    console.log(`  Sharpe:       ${backtestResult.sharpe.toFixed(2)}`);
    console.log(`  Start:        $${backtestResult.startCapital}`);
    console.log(`  End:          $${backtestResult.endCapital.toFixed(2)}`);
    console.log(`  Return:       ${backtestResult.totalReturn >= 0 ? '+' : ''}${backtestResult.totalReturn.toFixed(1)}%`);
    
    const verdict = backtestResult.winRate >= 60 && backtestResult.totalReturn > 0 ? '✅ EDGE CONFIRMED' 
                  : backtestResult.winRate >= 55 ? '🟡 MARGINAL EDGE' 
                  : '❌ NO EDGE';
    console.log(`\n  Verdict:      ${verdict}`);
  }

  else if (command === 'compare') {
    console.log('\n📊 Strategy Comparison\n');
    console.log('─'.repeat(80));
    
    // Load candles once
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(dbBuffer);
    
    const results = [];
    
    for (const [key, strategy] of Object.entries(strategies)) {
      const result = db.exec(
        `SELECT timestamp, open, high, low, close, volume
         FROM candles
         WHERE pair = ? AND interval = ?
         ORDER BY timestamp ASC`,
        [strategy.asset || 'BTC/USD', '1D']
      );
      
      if (result.length) {
        const { columns, values } = result[0];
        const candles = values.map(row => {
          const candle = {};
          columns.forEach((col, i) => candle[col] = row[i]);
          return candle;
        });
        
        const backtestResult = engine.backtest(candles, strategy);
        if (backtestResult.trades > 0) {
          results.push({
            name: key,
            ...backtestResult
          });
        }
      }
    }
    
    db.close();
    
    results.sort((a, b) => b.totalReturn - a.totalReturn);
    
    console.log('\n  Rank  Strategy              Trades    WR%    Return    Sharpe');
    console.log('  ' + '─'.repeat(60));
    
    results.forEach((r, idx) => {
      const verdict = r.winRate >= 60 && r.totalReturn > 0 ? '✅' : r.winRate >= 55 ? '🟡' : '❌';
      console.log(`  ${(idx+1).toString().padStart(2)}.    ${verdict} ${r.name.padEnd(20)} ${String(r.trades).padStart(4)}     ${r.winRate.toFixed(0)}%    ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(0)}%     ${r.sharpe.toFixed(2)}`);
    });
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
