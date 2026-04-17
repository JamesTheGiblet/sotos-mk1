#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const STATE_FILE = path.join(__dirname, 'engine_state.json');

class FourRedDaysEngine {
  constructor() {
    this.id = 'four-red-days';
    this.name = '4 Red Days';
    this.capital = 100;
    this.initialCapital = 100;
    this.position = null;
    this.consecutiveRed = 0;
    this.trades = [];
    this.status = 'dry_run';
    
    this.params = {
      targetPct: 1,
      stopPct: 0.75,
      maxHoldDays: 5,
      requiredRed: 4
    };
    
    this.lastProcessedIndex = -1;
    this.loadState();
  }
  
  loadState() {
    if (fs.existsSync(STATE_FILE)) {
      try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        this.capital = state.capital || 100;
        this.trades = state.trades || [];
        this.lastProcessedIndex = state.lastProcessedIndex || -1;
        this.position = state.position || null;
        this.consecutiveRed = state.consecutiveRed || 0;
        console.log(`📂 Loaded state: ${this.trades.length} trades, capital: $${this.capital.toFixed(2)}, last index: ${this.lastProcessedIndex}`);
      } catch (e) {
        console.log('📂 No valid state, starting fresh');
      }
    }
  }
  
  saveState() {
    const state = {
      capital: this.capital,
      trades: this.trades,
      lastProcessedIndex: this.lastProcessedIndex,
      position: this.position,
      consecutiveRed: this.consecutiveRed,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
  
  onCandle(candle, index) {
    // Skip if already processed
    if (index <= this.lastProcessedIndex) return;
    
    this.lastProcessedIndex = index;
    
    // Track consecutive red days
    if (candle.close < candle.open) {
      this.consecutiveRed++;
    } else {
      this.consecutiveRed = 0;
    }
    
    // Entry
    if (!this.position && this.consecutiveRed >= this.params.requiredRed) {
      this.enterPosition(candle);
    } 
    // Exit
    else if (this.position) {
      this.checkExit(candle);
    }
    
    // Save state after every candle
    this.saveState();
  }
  
  enterPosition(candle) {
    const price = candle.close;
    this.position = {
      entryPrice: price,
      entryDate: new Date().toISOString(),
      entryTimestamp: candle.timestamp,
      target: price * (1 + this.params.targetPct / 100),
      stop: price * (1 - this.params.stopPct / 100)
    };
    
    const logMsg = `🔵 ENTER @ ${price} | target: ${this.position.target.toFixed(2)} | stop: ${this.position.stop.toFixed(2)} | capital: $${this.capital.toFixed(2)}`;
    console.log(logMsg);
    this.appendLog(logMsg);
  }
  
  checkExit(candle) {
    const price = candle.close;
    const pnlPct = (price - this.position.entryPrice) / this.position.entryPrice * 100;
    const holdDays = Math.floor((candle.timestamp - this.position.entryTimestamp) / 86400);
    
    let exitReason = null;
    
    if (price >= this.position.target) {
      exitReason = 'take_profit';
    } else if (price <= this.position.stop) {
      exitReason = 'stop_loss';
    } else if (holdDays >= this.params.maxHoldDays) {
      exitReason = 'timeout';
    }
    
    if (exitReason) {
      this.exitPosition(price, exitReason, pnlPct, holdDays);
    }
  }
  
  exitPosition(price, reason, pnlPct, holdDays) {
    const pnl = this.capital * (pnlPct / 100);
    this.capital += pnl;
    
    const trade = {
      entryDate: this.position.entryDate,
      exitDate: new Date().toISOString(),
      entryPrice: this.position.entryPrice,
      exitPrice: price,
      pnlPct: pnlPct,
      pnl: pnl,
      win: pnl > 0,
      reason: reason,
      holdDays: holdDays
    };
    
    this.trades.push(trade);
    
    const winSymbol = trade.win ? '✅' : '❌';
    const logMsg = `${winSymbol} EXIT @ ${price} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%) | ${reason} | hold: ${holdDays}d | capital: $${this.capital.toFixed(2)}`;
    console.log(logMsg);
    this.appendLog(logMsg);
    
    this.position = null;
    this.consecutiveRed = 0;
  }
  
  appendLog(message) {
    const logFile = path.join(process.env.HOME, 'cce/engines/four-red-days/dryrun.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  }
  
  getStats() {
    const wins = this.trades.filter(t => t.win).length;
    const winRate = this.trades.length ? (wins / this.trades.length * 100) : 0;
    const totalReturn = ((this.capital - this.initialCapital) / this.initialCapital * 100);
    
    return {
      trades: this.trades.length,
      wins,
      winRate,
      totalReturn,
      capital: this.capital
    };
  }
  
  printSummary() {
    const stats = this.getStats();
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 ${this.name} — Dry Run Summary`);
    console.log('═'.repeat(60));
    console.log(`  Trades:        ${stats.trades}`);
    console.log(`  Win rate:      ${stats.winRate.toFixed(1)}%`);
    console.log(`  Total return:  ${stats.totalReturn >= 0 ? '+' : ''}${stats.totalReturn.toFixed(1)}%`);
    console.log(`  Capital:       $${stats.capital.toFixed(2)}`);
    console.log('═'.repeat(60));
  }
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🔍 Live Monitor — Four Red Days (Dry Run)');
  console.log('═'.repeat(60));
  console.log(`Checking for new candles every 5 minutes...\n`);

  const engine = new FourRedDaysEngine();
  
  // Initial load of candles (only new ones)
  const SQL = await initSqlJs();
  
  async function checkNewCandles() {
    try {
      const dbBuffer = fs.readFileSync(DB_PATH);
      const db = new SQL.Database(dbBuffer);
      
      const result = db.exec(`
        SELECT timestamp, open, high, low, close, volume
        FROM candles
        WHERE pair = 'BTC/USD' AND interval = '1D'
        ORDER BY timestamp ASC
      `);
      
      db.close();
      
      if (!result.length) return;
      
      const { columns, values } = result[0];
      const candles = values.map((row, idx) => {
        const candle = {};
        columns.forEach((col, i) => candle[col] = row[i]);
        candle.index = idx;
        return candle;
      });
      
      // Process only new candles
      let newCount = 0;
      for (const candle of candles) {
        if (candle.index > engine.lastProcessedIndex) {
          engine.onCandle(candle, candle.index);
          newCount++;
        }
      }
      
      if (newCount > 0) {
        const stats = engine.getStats();
        console.log(`📊 Processed ${newCount} new candles | ${stats.trades} trades | ${stats.winRate.toFixed(1)}% WR | $${stats.capital.toFixed(2)}`);
      }
      
    } catch (err) {
      console.error('❌ Error checking candles:', err.message);
    }
  }
  
  // Initial check
  await checkNewCandles();
  
  // Periodic check
  setInterval(checkNewCandles, 5 * 60 * 1000);
  
  // Handle shutdown
  process.on('SIGINT', () => {
    engine.printSummary();
    console.log('🛑 Monitor stopped');
    process.exit(0);
  });
}

main().catch(console.error);
