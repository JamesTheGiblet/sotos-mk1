#!/usr/bin/env node
'use strict';

/**
 * TRUE DISCOVERY ENGINE v2
 * Exhaustive grid search across strategy parameters with walk-forward validation.
 * All three periods must show positive expectancy for a strategy to pass.
 *
 * Fixes over original:
 *  - Correct double-cost bug (entry deducts from capital, exit deducts flat fee)
 *  - consecutiveRed no longer resets on trade exit (market state is independent)
 *  - RSI placeholder removed — calculateRSI fully implemented
 *  - price_drop uses candle open vs close (intra-candle drop), not prev close
 *  - Combined drop strategies: consecutive_red + price_drop multi-day
 *  - Sharpe ratio added to results
 *  - Progress logging per asset
 */

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(
  process.env.HOME,
  'kraken-intelligence/data/intelligence.db'
);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate RSI for candle at index i.
 * Uses standard Wilder smoothing.
 * Returns null if not enough data.
 */
function calculateRSI(candles, i, period = 14) {
  if (i < period) return null;

  let gains = 0;
  let losses = 0;

  for (let j = i - period + 1; j <= i; j++) {
    const delta = candles[j].close - candles[j - 1].close;
    if (delta > 0) gains  += delta;
    else           losses -= delta;
  }

  let avgGain = gains  / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs  = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate Sharpe ratio from an array of per-trade PnL percentages.
 */
function calculateSharpe(pnlArray) {
  if (pnlArray.length < 2) return 0;
  const mean = pnlArray.reduce((s, v) => s + v, 0) / pnlArray.length;
  const variance = pnlArray.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / pnlArray.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return mean / stdDev;
}

/**
 * Build a human-readable label for a strategy.
 */
function strategyLabel(strategy) {
  const p = strategy.params;
  switch (strategy.type) {
    case 'consecutive_red':
      return `${p.count}-red | tgt:${strategy.targetPct}% stp:${strategy.stopPct}% hold:${strategy.maxHoldDays}d`;
    case 'price_drop':
      return `drop>=${p.dropPct}% | tgt:${strategy.targetPct}% stp:${strategy.stopPct}% hold:${strategy.maxHoldDays}d`;
    case 'rsi_oversold':
      return `RSI(${p.period})<${p.threshold} | tgt:${strategy.targetPct}% stp:${strategy.stopPct}% hold:${strategy.maxHoldDays}d`;
    case 'red_and_drop':
      return `${p.count}-red+drop>=${p.dropPct}% | tgt:${strategy.targetPct}% stp:${strategy.stopPct}% hold:${strategy.maxHoldDays}d`;
    default:
      return JSON.stringify(strategy);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CLASS
// ─────────────────────────────────────────────────────────────────────────────

class TrueDiscovery {
  constructor() {
    this.costs = {
      entry: 0.0015,
      exit:  0.0015
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DATA
  // ───────────────────────────────────────────────────────────────────────────

  async getCandles(pair = 'BTC/USD', interval = '1D') {
    const SQL      = await initSqlJs();
    const dbBuffer = fs.readFileSync(DB_PATH);
    const db       = new SQL.Database(dbBuffer);

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
      columns.forEach((col, i) => { candle[col] = row[i]; });
      return candle;
    });
  }

  splitData(candles) {
    const size = Math.floor(candles.length / 3);
    return {
      train:    candles.slice(0, size),
      test:     candles.slice(size, size * 2),
      validate: candles.slice(size * 2)
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // BACKTEST
  // ───────────────────────────────────────────────────────────────────────────

  backtest(candles, strategy) {
    let capital  = 100;
    let position = null;
    let trades   = [];
    let consecutiveRed = 0;

    for (let i = 30; i < candles.length; i++) {
      const c = candles[i];

      // Update market state — always, regardless of position
      if (c.close < c.open) {
        consecutiveRed++;
      } else {
        consecutiveRed = 0;
      }

      // Determine entry signal
      let shouldEnter = false;

      if (!position) {
        switch (strategy.type) {

          case 'consecutive_red': {
            shouldEnter = consecutiveRed >= strategy.params.count;
            break;
          }

          case 'price_drop': {
            const dropPct = (c.open - c.close) / c.open * 100;
            shouldEnter   = dropPct >= strategy.params.dropPct;
            break;
          }

          case 'rsi_oversold': {
            const rsi = calculateRSI(candles, i, strategy.params.period);
            shouldEnter = rsi !== null && rsi < strategy.params.threshold;
            break;
          }

          case 'red_and_drop': {
            const dropPct = (c.open - c.close) / c.open * 100;
            shouldEnter   = consecutiveRed >= strategy.params.count
                         && dropPct >= strategy.params.dropPct;
            break;
          }
        }
      }

      // Open position
      if (!position && shouldEnter) {
        const entryCost = capital * this.costs.entry;
        capital        -= entryCost;
        position = {
          entryPrice: c.close,
          entryIndex: i,
          size:       capital
        };
        continue;
      }

      // Manage open position
      if (position) {
        const pnlPct   = (c.close - position.entryPrice) / position.entryPrice * 100;
        const holdDays = i - position.entryIndex;

        const hitTarget = pnlPct  >=  strategy.targetPct;
        const hitStop   = pnlPct  <= -strategy.stopPct;
        const hitHold   = holdDays >= strategy.maxHoldDays;

        if (hitTarget || hitStop || hitHold) {
          const grossPnl  = position.size * (pnlPct / 100);
          const exitCost  = position.size * this.costs.exit;
          capital        += grossPnl - exitCost;

          const netPnlPct = ((grossPnl - exitCost) / position.size) * 100;

          trades.push({
            win:        netPnlPct > 0,
            pnlPct:     netPnlPct,
            holdDays,
            exitReason: hitTarget ? 'target' : hitStop ? 'stop' : 'timeout'
          });

          position = null;
          // consecutiveRed NOT reset — market state is independent of trades
        }
      }
    }

    // Aggregate stats
    const numTrades = trades.length;
    if (numTrades === 0) {
      return { trades: 0, winRate: 0, expectancy: 0, totalReturn: 0, avgWin: 0, avgLoss: 0, sharpe: 0 };
    }

    const wins    = trades.filter(t =>  t.win);
    const losses  = trades.filter(t => !t.win);

    const winRate  = (wins.length / numTrades) * 100;
    const lossRate = 1 - (winRate / 100);

    const avgWin  = wins.length
      ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length
      : 0;

    const avgLoss = losses.length
      ? Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length)
      : 0;

    const expectancy  = (winRate / 100 * avgWin) - (lossRate * avgLoss);
    const totalReturn = ((capital - 100) / 100) * 100;
    const sharpe      = calculateSharpe(trades.map(t => t.pnlPct));

    return {
      trades:      numTrades,
      winRate:     +winRate.toFixed(2),
      expectancy:  +expectancy.toFixed(3),
      totalReturn: +totalReturn.toFixed(2),
      avgWin:      +avgWin.toFixed(3),
      avgLoss:     +avgLoss.toFixed(3),
      sharpe:      +sharpe.toFixed(3)
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STRATEGY GRID GENERATORS
  // ───────────────────────────────────────────────────────────────────────────

  *generateStrategies() {
    const targets  = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
    const stops    = [0.5, 0.75, 1, 1.5, 2, 2.5];
    const holdDays = [2, 3, 5, 7, 10, 14];

    // Type 1: Consecutive red days
    for (const count of [2, 3, 4, 5, 6]) {
      for (const targetPct of targets) {
        for (const stopPct of stops) {
          if (stopPct >= targetPct) continue;
          for (const maxHoldDays of holdDays) {
            yield { type: 'consecutive_red', params: { count }, targetPct, stopPct, maxHoldDays };
          }
        }
      }
    }

    // Type 2: Single candle intra-day price drop
    for (const dropPct of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
      for (const targetPct of targets) {
        for (const stopPct of stops) {
          if (stopPct >= targetPct) continue;
          for (const maxHoldDays of holdDays) {
            yield { type: 'price_drop', params: { dropPct }, targetPct, stopPct, maxHoldDays };
          }
        }
      }
    }

    // Type 3: RSI oversold
    for (const period of [7, 14, 21]) {
      for (const threshold of [20, 25, 30, 35]) {
        for (const targetPct of targets) {
          for (const stopPct of stops) {
            if (stopPct >= targetPct) continue;
            for (const maxHoldDays of holdDays) {
              yield { type: 'rsi_oversold', params: { period, threshold }, targetPct, stopPct, maxHoldDays };
            }
          }
        }
      }
    }

    // Type 4: Consecutive red + intra-candle drop combo
    for (const count of [2, 3, 4]) {
      for (const dropPct of [1, 2, 3, 5]) {
        for (const targetPct of targets) {
          for (const stopPct of stops) {
            if (stopPct >= targetPct) continue;
            for (const maxHoldDays of holdDays) {
              yield { type: 'red_and_drop', params: { count, dropPct }, targetPct, stopPct, maxHoldDays };
            }
          }
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DISCOVER
  // ───────────────────────────────────────────────────────────────────────────

  async discover(pair = 'BTC/USD') {
    console.log('\n' + '='.repeat(70));
    console.log('🔍  TRUE DISCOVERY — ' + pair);
    console.log('='.repeat(70));

    const allCandles = await this.getCandles(pair, '1D');
    if (allCandles.length < 90) {
      console.log('❌  Not enough candles for ' + pair + ' (' + allCandles.length + '). Skipping.');
      return [];
    }

    const periods = this.splitData(allCandles);
    const dateOf  = ts => new Date(ts * 1000).toISOString().slice(0, 10);

    console.log('Candles: ' + allCandles.length + ' total');
    console.log('  TRAIN:    ' + dateOf(periods.train[0].timestamp) + ' -> ' + dateOf(periods.train[periods.train.length - 1].timestamp) + ' (' + periods.train.length + ')');
    console.log('  TEST:     ' + dateOf(periods.test[0].timestamp)  + ' -> ' + dateOf(periods.test[periods.test.length - 1].timestamp)   + ' (' + periods.test.length  + ')');
    console.log('  VALIDATE: ' + dateOf(periods.validate[0].timestamp) + ' -> ' + dateOf(periods.validate[periods.validate.length - 1].timestamp) + ' (' + periods.validate.length + ')\n');

    const results    = [];
    let   totalTests = 0;
    let   lastLog    = 0;

    for (const strategy of this.generateStrategies()) {
      totalTests++;

      if (totalTests - lastLog >= 500) {
        process.stdout.write('  Tested ' + totalTests + '... found ' + results.length + ' so far\r');
        lastLog = totalTests;
      }

      const train    = this.backtest(periods.train,    strategy);
      const test     = this.backtest(periods.test,     strategy);
      const validate = this.backtest(periods.validate, strategy);

      if (train.trades < 5 || test.trades < 3 || validate.trades < 3) continue;

      const minE = 0.3;
      if (train.expectancy    > minE
       && test.expectancy     > minE
       && validate.expectancy > minE) {

        const score = (train.expectancy + test.expectancy + validate.expectancy) / 3;
        results.push({ strategy, train, test, validate, score, pair });
      }
    }

    console.log('\n📊  Scanned ' + totalTests + ' combinations');
    console.log('✅  ' + results.length + ' strategies pass (E > 0.3 on all three periods)\n');

    results.sort((a, b) => b.score - a.score);

    console.log('🏆  TOP 10 STRATEGIES');
    console.log('-'.repeat(70));

    results.slice(0, 10).forEach((r, idx) => {
      console.log('\n' + (idx + 1) + '. ' + strategyLabel(r.strategy) + '  [score: ' + r.score.toFixed(3) + ']');
      console.log('   Train:    ' + String(r.train.trades).padStart(3) + ' trades | WR:' + r.train.winRate.toFixed(1).padStart(5) + '% | E:' + r.train.expectancy.toFixed(2).padStart(5) + ' | R:' + r.train.totalReturn.toFixed(1).padStart(6) + '% | Sharpe:' + r.train.sharpe.toFixed(2));
      console.log('   Test:     ' + String(r.test.trades).padStart(3) + ' trades | WR:' + r.test.winRate.toFixed(1).padStart(5) + '% | E:' + r.test.expectancy.toFixed(2).padStart(5) + ' | R:' + r.test.totalReturn.toFixed(1).padStart(6) + '% | Sharpe:' + r.test.sharpe.toFixed(2));
      console.log('   Validate: ' + String(r.validate.trades).padStart(3) + ' trades | WR:' + r.validate.winRate.toFixed(1).padStart(5) + '% | E:' + r.validate.expectancy.toFixed(2).padStart(5) + ' | R:' + r.validate.totalReturn.toFixed(1).padStart(6) + '% | Sharpe:' + r.validate.sharpe.toFixed(2));
    });

    const outDir  = path.join(__dirname, '../strategies');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, 'true_discovery_' + pair.replace('/', '_') + '.json');
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log('\n💾  Saved ' + results.length + ' results -> ' + outFile);

    return results;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  const pairs   = process.argv.slice(2);
  const targets = pairs.length ? pairs : ['BTC/USD'];

  const discovery  = new TrueDiscovery();
  const allResults = {};

  for (const pair of targets) {
    allResults[pair] = await discovery.discover(pair);
  }

  // Cross-asset summary
  if (targets.length > 1) {
    console.log('\n' + '='.repeat(70));
    console.log('📈  CROSS-ASSET SUMMARY');
    console.log('='.repeat(70));

    const labelMap = {};
    for (const [pair, results] of Object.entries(allResults)) {
      for (const r of results.slice(0, 20)) {
        const label = strategyLabel(r.strategy);
        if (!labelMap[label]) labelMap[label] = [];
        labelMap[label].push({ pair, score: r.score });
      }
    }

    const crossAsset = Object.entries(labelMap)
      .filter(([, hits]) => hits.length > 1)
      .sort((a, b) =>
        b[1].length - a[1].length ||
        b[1].reduce((s, h) => s + h.score, 0) - a[1].reduce((s, h) => s + h.score, 0)
      );

    if (crossAsset.length) {
      console.log('\nStrategies in top 20 across multiple assets:');
      crossAsset.forEach(([label, hits]) => {
        const pairStr = hits.map(h => h.pair + '(' + h.score.toFixed(2) + ')').join('  ');
        console.log('  * ' + label);
        console.log('    ' + pairStr);
      });
    } else {
      console.log('\nNo strategies appeared in top 20 across multiple assets.');
      console.log('Edges appear asset-specific — expected for crypto regimes.');
    }
  }
})().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
