#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const COSTS = { entry: 0.0015, exit: 0.0015 };

function calculateRSI(prices, period) {
  period = period || 14;
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function backtest(candles, strat, startCapital) {
  startCapital = startCapital || 100;
  let capital = startCapital;
  let position = null;
  let trades = [];
  let consecutiveRed = 0;

  for (let i = 30; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.close < candle.open) consecutiveRed++;
    else consecutiveRed = 0;

    let shouldEnter = false;
    if (strat.signalLogic === "consecutive_red") {
      shouldEnter = consecutiveRed >= (strat.requiredRed || 4);
    }
    if (strat.signalLogic === "rsi_oversold") {
      if (i >= (strat.rsiPeriod || 14)) {
        const prices = candles.slice(i - (strat.rsiPeriod || 14), i + 1).map(c => c.close);
        const rsi = calculateRSI(prices, strat.rsiPeriod || 14);
        shouldEnter = rsi < (strat.rsiThreshold || 25);
      }
    }
    if (strat.signalLogic === "consecutive_red_or_rsi") {
      let rsiSignal = false;
      if (i >= (strat.rsiPeriod || 21)) {
        const prices = candles.slice(i - (strat.rsiPeriod || 21), i + 1).map(c => c.close);
        const rsi = calculateRSI(prices, strat.rsiPeriod || 21);
        rsiSignal = rsi < (strat.rsiThreshold || 20);
      }
      shouldEnter = consecutiveRed >= (strat.requiredRed || 4) || rsiSignal;
    }

    if (!position && shouldEnter) {
      let entryPrice = candle.close;
      if (strat.entryTiming === "next_open" && i + 1 < candles.length) {
        entryPrice = candles[i + 1].open;
      }
      const entryCost = capital * COSTS.entry;
      capital -= entryCost;
      position = {
        entryPrice: entryPrice,
        entryTimestamp: candle.timestamp,
        size: capital,
        target: entryPrice * (1 + (strat.targetPct || 1) / 100),
        stop: entryPrice * (1 - (strat.stopPct || 0.75) / 100)
      };
      continue;
    }

    if (position) {
      const price = candle.close;
      const pnlPct = (price - position.entryPrice) / position.entryPrice * 100;
      const holdDays = Math.floor((candle.timestamp - position.entryTimestamp) / 86400);
      let exitReason = null;
      if (price >= position.target) exitReason = "take_profit";
      else if (price <= position.stop) exitReason = "stop_loss";
      else if (holdDays >= (strat.maxHoldDays || 5)) exitReason = "timeout";
      if (exitReason) {
        const grossPnl = position.size * (pnlPct / 100);
        const exitCost = position.size * COSTS.exit;
        const netPnl = grossPnl - exitCost;
        capital += netPnl;
        trades.push({ win: netPnl > 0 });
        position = null;
        consecutiveRed = 0;
      }
    }
  }

  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;
  const totalReturn = ((capital - startCapital) / startCapital * 100);
  return { trades: trades.length, winRate, totalReturn };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("FORWARD TEST — Strategy Validation");
  console.error("=".repeat(70));
  console.error("Transaction costs: 0.3% per trade\n");

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  const strategies = [
    { name: "Smart BTC", asset: "BTC/USD", signalLogic: "consecutive_red_or_rsi", targetPct: 5, stopPct: 2.5, maxHoldDays: 14, requiredRed: 4, rsiPeriod: 21, rsiThreshold: 20, entryTiming: "next_open" },
    { name: "XRP RSI", asset: "XRP/USD", signalLogic: "rsi_oversold", targetPct: 5, stopPct: 1.5, maxHoldDays: 7, rsiPeriod: 14, rsiThreshold: 25, entryTiming: "next_open" },
    { name: "4 Red Optimized", asset: "BTC/USD", signalLogic: "consecutive_red", targetPct: 5, stopPct: 2.5, maxHoldDays: 14, requiredRed: 4, entryTiming: "next_open" },
    { name: "4 Red Original", asset: "BTC/USD", signalLogic: "consecutive_red", targetPct: 1, stopPct: 0.75, maxHoldDays: 5, requiredRed: 4, entryTiming: "next_open" }
  ];

  for (const strat of strategies) {
    const result = db.exec(
      "SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC",
      [strat.asset, "1D"]
    );
    if (!result.length) {
      console.error("No data for " + strat.asset);
      continue;
    }
    const { columns, values } = result[0];
    const candles = values.map(row => {
      const c = {};
      columns.forEach((col, i) => c[col] = row[i]);
      return c;
    });
    const splitIdx = Math.floor(candles.length * 0.8);
    const trainCandles = candles.slice(0, splitIdx);
    const testCandles = candles.slice(splitIdx);
    const trainResult = backtest(trainCandles, strat);
    const testResult = backtest(testCandles, strat);
    const verdict = (testResult.winRate >= 55 && testResult.totalReturn > 0) ? "PASS" : ((testResult.totalReturn > 0) ? "MARGINAL" : "FAIL");
    console.error("\n" + verdict + " " + strat.name);
    console.error("   TRAIN: " + trainResult.trades + " trades | " + trainResult.winRate.toFixed(1) + "% WR | +" + trainResult.totalReturn.toFixed(1) + "%");
    console.error("   TEST:  " + testResult.trades + " trades | " + testResult.winRate.toFixed(1) + "% WR | " + (testResult.totalReturn >= 0 ? "+" : "") + testResult.totalReturn.toFixed(1) + "%");
  }

  db.close();
  console.error("\n" + "=".repeat(70));
  console.error("Forward test complete");
  console.error("=".repeat(70));
}

main().catch(console.error);
