const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const COSTS = { entry: 0.0015, exit: 0.0015 };

class StrategyValidator {
  constructor() {
    this.results = [];
    this.maxOptimizationAttempts = 10;
  }

  async getCandles(pair = 'BTC/USD') {
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(dbBuffer);
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = '1D'
       ORDER BY timestamp ASC`,
      [pair]
    );
    db.close();
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
      const c = {};
      columns.forEach((col, i) => c[col] = row[i]);
      return c;
    });
  }

  calculateRSI(prices, period) {
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

  backtest(candles, strategy, startCapital = 100) {
    let capital = startCapital;
    let position = null;
    let trades = [];
    let consecutiveRed = 0;

    for (let i = 30; i < candles.length; i++) {
      const candle = candles[i];
      if (candle.close < candle.open) consecutiveRed++;
      else consecutiveRed = 0;

      let shouldEnter = false;
      
      if (strategy.type === 'consecutive_red') {
        shouldEnter = consecutiveRed >= (strategy.count || 4);
      }
      if (strategy.type === 'rsi_oversold') {
        if (i >= (strategy.period || 14)) {
          const prices = candles.slice(i - (strategy.period || 14), i + 1).map(c => c.close);
          const rsi = this.calculateRSI(prices, strategy.period || 14);
          shouldEnter = rsi < (strategy.threshold || 30);
        }
      }
      if (strategy.type === 'grid') {
        shouldEnter = true;
      }

      if (!position && shouldEnter) {
        let entryPrice = candle.close;
        const entryCost = capital * COSTS.entry;
        capital -= entryCost;
        position = {
          entryPrice: entryPrice,
          entryTimestamp: candle.timestamp,
          size: capital,
          target: entryPrice * (1 + (strategy.target || 2) / 100),
          stop: entryPrice * (1 - (strategy.stop || 1) / 100)
        };
        continue;
      }

      if (position) {
        const price = candle.close;
        const pnlPct = (price - position.entryPrice) / position.entryPrice * 100;
        const holdDays = Math.floor((candle.timestamp - position.entryTimestamp) / 86400);
        let exitReason = null;
        if (price >= position.target) exitReason = 'take_profit';
        else if (price <= position.stop) exitReason = 'stop_loss';
        else if (holdDays >= (strategy.hold || 5)) exitReason = 'timeout';
        if (exitReason) {
          const grossPnl = position.size * (pnlPct / 100);
          const exitCost = position.size * COSTS.exit;
          const netPnl = grossPnl - exitCost;
          capital += netPnl;
          trades.push({ win: netPnl > 0, pnlPct: (netPnl / position.size) * 100 });
          position = null;
          consecutiveRed = 0;
        }
      }
    }

    const wins = trades.filter(t => t.win).length;
    const winRate = trades.length ? (wins / trades.length * 100) : 0;
    const totalReturn = ((capital - startCapital) / startCapital * 100);
    const avgWin = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / (wins || 1);
    const avgLoss = trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) / ((trades.length - wins) || 1);
    const expectancy = (winRate / 100 * avgWin) - ((1 - winRate / 100) * Math.abs(avgLoss));
    const profitFactor = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / Math.abs(trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) || 1);
    const sharpe = trades.length ? (avgWin / Math.abs(avgLoss)) * Math.sqrt(trades.length) / 10 : 0;

    return { trades: trades.length, winRate, totalReturn, expectancy, profitFactor, sharpe, finalCapital: capital };
  }

  calculateScore(result) {
    return (result.winRate * 10) + (result.totalReturn * 2) + (result.sharpe * 20);
  }

  getGrade(score) {
    if (score >= 70) return { grade: 'A', text: 'EXCELLENT - Ready for dry run' };
    if (score >= 60) return { grade: 'B', text: 'GOOD - Proceed to dry run' };
    if (score >= 50) return { grade: 'C', text: 'MARGINAL - Consider optimization' };
    return { grade: 'F', text: 'FAIL - Reject strategy' };
  }

  adjustParameters(strategy, attempt) {
    const adjusted = { ...strategy };
    
    // Adjust target based on attempt
    if (strategy.type === 'consecutive_red') {
      // Try different red counts
      const redCounts = [2, 3, 4, 5, 6];
      adjusted.count = redCounts[attempt % redCounts.length];
    }
    
    if (strategy.type === 'rsi_oversold') {
      // Try different RSI thresholds
      const thresholds = [20, 25, 30, 35, 40];
      adjusted.threshold = thresholds[attempt % thresholds.length];
      // Try different periods
      const periods = [7, 14, 21, 30];
      adjusted.period = periods[Math.floor(attempt / thresholds.length) % periods.length];
    }
    
    // Adjust target (1% to 8%)
    const targets = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
    adjusted.target = targets[attempt % targets.length];
    
    // Adjust stop (30-50% of target)
    adjusted.stop = Math.max(0.5, adjusted.target * (0.3 + (attempt % 3) * 0.1));
    adjusted.stop = Math.round(adjusted.stop * 10) / 10;
    
    // Adjust hold days
    const holds = [2, 3, 5, 7, 10, 14];
    adjusted.hold = holds[attempt % holds.length];
    
    return adjusted;
  }

  async validateStrategy(strategy, strategyName, autoOptimize = true) {
    console.log('\n' + '='.repeat(70));
    console.log('🔬 Validating Strategy: ' + strategyName);
    console.log('='.repeat(70));
    
    const allCandles = await this.getCandles('BTC/USD');
    if (allCandles.length === 0) {
      console.log('❌ No data available');
      return { passed: false, reason: 'No data' };
    }

    const splitIdx = Math.floor(allCandles.length * 0.8);
    const trainCandles = allCandles.slice(0, splitIdx);
    const testCandles = allCandles.slice(splitIdx);

    let currentStrategy = { ...strategy };
    let attempts = 0;
    let bestResult = null;
    let bestStrategy = null;
    let optimizationHistory = [];

    while (attempts < this.maxOptimizationAttempts) {
      const attemptNum = attempts + 1;
      console.log(`\n📊 Attempt ${attemptNum}/${this.maxOptimizationAttempts}`);
      console.log(`   Parameters: Target ${currentStrategy.target}% | Stop ${currentStrategy.stop}% | Hold ${currentStrategy.hold}d`);
      if (currentStrategy.count) console.log(`   Red Count: ${currentStrategy.count}`);
      if (currentStrategy.threshold) console.log(`   RSI Threshold: ${currentStrategy.threshold}`);

      const backtestResult = this.backtest(trainCandles, currentStrategy);
      const forwardResult = this.backtest(testCandles, currentStrategy);
      const score = this.calculateScore(backtestResult);
      
      const result = {
        attempt: attemptNum,
        strategy: { ...currentStrategy },
        backtest: backtestResult,
        forward: forwardResult,
        score: score,
        passed: this.checkPassCriteria(backtestResult, forwardResult, score)
      };
      
      optimizationHistory.push(result);
      
      if (result.passed) {
        console.log(`\n✅ VALIDATION PASSED on attempt ${attemptNum}!`);
        bestResult = result;
        bestStrategy = currentStrategy;
        break;
      } else {
        console.log(`\n❌ Attempt ${attemptNum} failed:`);
        this.printFailReasons(backtestResult, forwardResult, score);
        
        if (attemptNum < this.maxOptimizationAttempts && autoOptimize) {
          currentStrategy = this.adjustParameters(strategy, attempts);
          console.log(`\n🔄 Adjusting parameters for next attempt...`);
        }
      }
      
      attempts++;
    }

    // Final verdict
    console.log('\n' + '='.repeat(70));
    if (bestResult) {
      console.log('✅ STRATEGY VALIDATED');
      console.log(`   Optimal parameters: Target ${bestStrategy.target}% | Stop ${bestStrategy.stop}% | Hold ${bestStrategy.hold}d`);
      if (bestStrategy.count) console.log(`   Red Count: ${bestStrategy.count}`);
      console.log(`   Backtest WR: ${bestResult.backtest.winRate.toFixed(1)}% | Return: +${bestResult.backtest.totalReturn.toFixed(1)}%`);
      console.log(`   Forward WR: ${bestResult.forward.winRate.toFixed(1)}% | Return: +${bestResult.forward.totalReturn.toFixed(1)}%`);
      console.log(`   Score: ${bestResult.score.toFixed(1)}`);
      
      return {
        passed: true,
        strategy: strategyName,
        optimalStrategy: bestStrategy,
        optimalResult: bestResult,
        optimizationHistory: optimizationHistory,
        attemptsUsed: attempts
      };
    } else {
      console.log('❌ STRATEGY FAILED VALIDATION AFTER ' + this.maxOptimizationAttempts + ' ATTEMPTS');
      console.log('   Moving to UNDER REVIEW status');
      
      return {
        passed: false,
        strategy: strategyName,
        status: 'UNDER_REVIEW',
        optimizationHistory: optimizationHistory,
        attemptsUsed: attempts,
        reason: 'Failed all optimization attempts'
      };
    }
  }

  checkPassCriteria(backtest, forward, score) {
    return (backtest.trades >= 8 &&
            backtest.winRate >= 55 &&
            backtest.totalReturn > 0 &&
            forward.winRate >= 55 &&
            forward.totalReturn > 0 &&
            (backtest.winRate - forward.winRate) < 20 &&
            score >= 60);
  }

  printFailReasons(backtest, forward, score) {
    if (backtest.trades < 8) console.log(`   - Insufficient trades: ${backtest.trades} < 8`);
    if (backtest.winRate < 55) console.log(`   - Backtest win rate: ${backtest.winRate.toFixed(1)}% < 55%`);
    if (backtest.totalReturn <= 0) console.log(`   - Backtest return: ${backtest.totalReturn.toFixed(1)}% not positive`);
    if (forward.winRate < 55) console.log(`   - Forward win rate: ${forward.winRate.toFixed(1)}% < 55%`);
    if (forward.totalReturn <= 0) console.log(`   - Forward return: ${forward.totalReturn.toFixed(1)}% not positive`);
    if ((backtest.winRate - forward.winRate) >= 20) console.log(`   - Degradation too high: ${(backtest.winRate - forward.winRate).toFixed(1)}%`);
    if (score < 60) console.log(`   - Score too low: ${score.toFixed(1)} < 60`);
  }
}

module.exports = StrategyValidator;
