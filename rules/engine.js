#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

class RuleEngine {
  constructor() {
    this.indicators = this.initIndicators();
  }

  initIndicators() {
    return {
      // Price-based
      price: (c, i, params) => {
        const { compare, value, offset = 0 } = params;
        const price = c[i].close;
        if (compare === '>') return price > value;
        if (compare === '<') return price < value;
        if (compare === '>=') return price >= value;
        if (compare === '<=') return price <= value;
        if (compare === '==') return price === value;
        return false;
      },

      // Price change over periods
      change: (c, i, params) => {
        const { periods = 1, compare, value, type = 'close' } = params;
        if (i < periods) return false;
        const oldPrice = c[i - periods][type];
        const currentPrice = c[i][type];
        const changePct = (currentPrice - oldPrice) / oldPrice * 100;
        if (compare === '>') return changePct > value;
        if (compare === '<') return changePct < value;
        if (compare === '>=') return changePct >= value;
        if (compare === '<=') return changePct <= value;
        return false;
      },

      // Consecutive candles
      consecutive: (c, i, params) => {
        const { count = 3, direction = 'red' } = params;
        if (i < count) return false;
        for (let j = 0; j < count; j++) {
          const isRed = c[i - j].close < c[i - j].open;
          if (direction === 'red' && !isRed) return false;
          if (direction === 'green' && isRed) return false;
        }
        return true;
      },

      // RSI
      rsi: (c, i, params) => {
        const { period = 14, compare, value } = params;
        if (i < period + 1) return false;
        const prices = c.slice(i - period, i + 1).map(x => x.close);
        const rsi = this.calculateRSI(prices, period);
        if (compare === '>') return rsi > value;
        if (compare === '<') return rsi < value;
        return false;
      },

      // Moving average
      ma: (c, i, params) => {
        const { period = 20, compare, value, type = 'close' } = params;
        if (i < period) return false;
        const ma = c.slice(i - period, i + 1).reduce((s, x) => s + x[type], 0) / period;
        if (compare === '>') return ma > value;
        if (compare === '<') return ma < value;
        if (compare === 'price_above') return c[i].close > ma;
        if (compare === 'price_below') return c[i].close < ma;
        return false;
      },

      // Volume
      volume: (c, i, params) => {
        const { period = 14, compare, multiplier = 1 } = params;
        if (i < period) return false;
        const avgVol = c.slice(i - period, i + 1).reduce((s, x) => s + x.volume, 0) / period;
        const volRatio = c[i].volume / avgVol;
        if (compare === '>') return volRatio > multiplier;
        if (compare === '<') return volRatio < multiplier;
        return false;
      },

      // Volatility
      volatility: (c, i, params) => {
        const { period = 14, compare, value, type = 'returns' } = params;
        if (i < period) return false;
        const returns = [];
        for (let j = i - period; j <= i; j++) {
          if (j > 0) {
            returns.push((c[j].close - c[j-1].close) / c[j-1].close);
          }
        }
        const vol = this.std(returns) * 100;
        if (compare === '>') return vol > value;
        if (compare === '<') return vol < value;
        return false;
      },

      // Z-score (mean reversion)
      zscore: (c, i, params) => {
        const { period = 90, compare, value } = params;
        if (i < period) return false;
        const prices = c.slice(i - period, i + 1).map(x => x.close);
        const z = this.zscore(c[i].close, prices);
        if (compare === '>') return z > value;
        if (compare === '<') return z < value;
        if (compare === 'abs>') return Math.abs(z) > value;
        return false;
      },

      // Time of day/week
      time: (c, i, params) => {
        const { hour, minute = 0, dayOfWeek, compare = '==' } = params;
        const date = new Date(c[i].timestamp * 1000);
        const currentHour = date.getUTCHours();
        const currentMinute = date.getUTCMinutes();
        const currentDay = date.getUTCDay();

        if (hour !== undefined && currentHour !== hour) return false;
        if (minute !== undefined && Math.abs(currentMinute - minute) > 5) return false;
        if (dayOfWeek !== undefined && currentDay !== dayOfWeek) return false;
        return true;
      },

      // Pattern detection
      pattern: (c, i, params) => {
        const { name } = params;
        if (name === 'hammer') return this.isHammer(c[i]);
        if (name === 'engulfing') return this.isEngulfing(c, i);
        if (name === 'doji') return this.isDoji(c[i]);
        return false;
      },

      // Logical operators
      and: (c, i, params, context) => {
        return params.conditions.every(cond => this.evaluateCondition(c, i, cond, context));
      },

      or: (c, i, params, context) => {
        return params.conditions.some(cond => this.evaluateCondition(c, i, cond, context));
      },

      not: (c, i, params, context) => {
        return !this.evaluateCondition(c, i, params.condition, context);
      }
    };
  }

  evaluateCondition(c, i, condition, context = {}) {
    const { type, params = {}, conditions } = condition;
    
    if (type === 'and' || type === 'or') {
      return this.indicators[type](c, i, { conditions }, context);
    }
    
    if (type === 'not') {
      return this.indicators[type](c, i, { condition: conditions?.[0] }, context);
    }

    const indicator = this.indicators[type];
    if (!indicator) {
      console.warn(`Unknown indicator type: ${type}`);
      return false;
    }

    return indicator(c, i, params);
  }

  evaluateStrategy(candles, strategy, startIdx = 20) {
    const entries = [];
    const { entryRules, exitRules, params = {} } = strategy;

    for (let i = startIdx; i < candles.length; i++) {
      const shouldEnter = this.evaluateCondition(candles, i, entryRules);
      if (shouldEnter) {
        entries.push({
          index: i,
          price: candles[i].close,
          timestamp: candles[i].timestamp,
          date: new Date(candles[i].timestamp * 1000).toISOString()
        });
      }
    }

    return entries;
  }

  backtest(candles, strategy, capital = 100) {
    const { entryRules, exitRules, params = {} } = strategy;
    let cash = capital;
    let position = null;
    const trades = [];

    const defaultExit = {
      targetPct: params.targetPct || 2,
      stopPct: params.stopPct || 1.5,
      maxHoldDays: params.maxHoldDays || 3
    };

    for (let i = 20; i < candles.length; i++) {
      if (!position) {
        const shouldEnter = this.evaluateCondition(candles, i, entryRules);
        if (shouldEnter) {
          position = {
            entryPrice: candles[i].close,
            entryIdx: i,
            entryDate: candles[i].timestamp,
            size: cash
          };
        }
      } else {
        const holdDays = Math.floor((candles[i].timestamp - position.entryDate) / 86400);
        const pnlPct = (candles[i].close - position.entryPrice) / position.entryPrice * 100;
        
        let shouldExit = false;
        let exitReason = '';

        // Check explicit exit rules
        if (exitRules) {
          shouldExit = this.evaluateCondition(candles, i, exitRules, { position, pnlPct, holdDays });
          if (shouldExit) exitReason = 'rule_exit';
        }

        // Check default exits
        if (!shouldExit && pnlPct >= defaultExit.targetPct) {
          shouldExit = true;
          exitReason = 'take_profit';
        }
        if (!shouldExit && pnlPct <= -defaultExit.stopPct) {
          shouldExit = true;
          exitReason = 'stop_loss';
        }
        if (!shouldExit && holdDays >= defaultExit.maxHoldDays) {
          shouldExit = true;
          exitReason = 'timeout';
        }

        if (shouldExit) {
          const pnl = position.size * (pnlPct / 100);
          cash += pnl;
          trades.push({
            entryPrice: position.entryPrice,
            exitPrice: candles[i].close,
            pnlPct,
            pnl,
            holdDays,
            exitReason,
            win: pnl > 0,
            entryDate: new Date(position.entryDate * 1000).toISOString(),
            exitDate: new Date(candles[i].timestamp * 1000).toISOString()
          });
          position = null;
        }
      }
    }

    const wins = trades.filter(t => t.win).length;
    const losses = trades.filter(t => !t.win).length;
    const winRate = trades.length ? (wins / trades.length * 100) : 0;
    const avgPnl = trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;
    const avgWin = wins ? trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / wins : 0;
    const avgLoss = losses ? trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) / losses : 0;
    const avgHold = trades.length ? trades.reduce((s, t) => s + t.holdDays, 0) / trades.length : 0;
    const totalReturn = (cash / capital - 1) * 100;
    const sharpe = this.calculateSharpe(trades.map(t => t.pnlPct));

    return {
      trades: trades.length,
      wins,
      losses,
      winRate,
      avgPnl,
      avgWin,
      avgLoss,
      avgHold,
      startCapital: capital,
      endCapital: cash,
      totalReturn,
      sharpe,
      tradesList: trades,
      isValid: trades.length >= 10
    };
  }

  calculateSharpe(returns, riskFreeRate = 0) {
    if (returns.length < 2) return 0;
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / returns.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return (avg - riskFreeRate) / std;
  }

  calculateRSI(prices, period = 14) {
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

  zscore(value, arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return (value - mean) / std;
  }

  std(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  // Candlestick patterns
  isHammer(candle) {
    const body = Math.abs(candle.close - candle.open);
    const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
    const upperShadow = candle.high - Math.max(candle.open, candle.close);
    return lowerShadow > body * 2 && upperShadow < body * 0.3;
  }

  isEngulfing(candles, i) {
    if (i < 1) return false;
    const prev = candles[i-1];
    const curr = candles[i];
    const prevBullish = prev.close > prev.open;
    const currBearish = curr.close < curr.open;
    return prevBullish && currBearish && curr.open > prev.close && curr.close < prev.open;
  }

  isDoji(candle) {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    return body < range * 0.1;
  }
}

module.exports = RuleEngine;
