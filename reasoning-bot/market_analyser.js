const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

class MarketAnalyser {
  constructor() {
    this.state = {
      regime: 'UNKNOWN',
      sentiment: 'NEUTRAL',
      phase: 'UNKNOWN',
      volatility: 0,
      trend: 0,
      volumeRatio: 1,
      btcPrice: 0,
      lastUpdated: null
    };
  }

  async analyse() {
    try {
      const SQL = await initSqlJs();
      const dbBuffer = fs.readFileSync(DB_PATH);
      const db = new SQL.Database(dbBuffer);

      const result = db.exec(`
        SELECT timestamp, open, high, low, close, volume
        FROM candles
        WHERE pair = 'BTC/USD' AND interval = '1D'
        ORDER BY timestamp DESC
        LIMIT 200
      `);

      db.close();

      if (!result.length || !result[0].values.length) {
        console.error('No candle data found');
        return this.getDefaultState();
      }

      const { columns, values } = result[0];
      const candles = values.map(row => {
        const c = {};
        columns.forEach((col, i) => c[col] = row[i]);
        return c;
      }).reverse();

      if (candles.length < 50) {
        console.error('Insufficient candle data');
        return this.getDefaultState();
      }

      const prices = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume);
      
      // Calculate returns
      const returns = [];
      for (let i = 1; i < prices.length; i++) {
        if (prices[i-1] > 0) {
          returns.push((prices[i] - prices[i-1]) / prices[i-1] * 100);
        }
      }
      
      // Volatility (14-day standard deviation)
      const vol14 = returns.length >= 14 ? this.stdDev(returns.slice(-14)) : 1.5;
      this.state.volatility = isNaN(vol14) ? 1.5 : vol14;

      // Trend (20-day price change)
      const price20dAgo = prices[prices.length - 21] || prices[0];
      const currentPrice = prices[prices.length - 1];
      const trend20 = price20dAgo > 0 ? (currentPrice - price20dAgo) / price20dAgo * 100 : 0;
      this.state.trend = isNaN(trend20) ? 0 : trend20;

      // Volume ratio
      const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const lastVol = volumes[volumes.length - 1];
      this.state.volumeRatio = avgVol20 > 0 ? lastVol / avgVol20 : 1;
      if (isNaN(this.state.volumeRatio)) this.state.volumeRatio = 1;

      // BTC Price
      this.state.btcPrice = currentPrice;

      // Determine regime
      if (Math.abs(trend20) > 15 && vol14 > 2) {
        this.state.regime = trend20 > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
      } else if (vol14 > 3) {
        this.state.regime = 'VOLATILE';
      } else if (vol14 < 1.5) {
        this.state.regime = 'QUIET';
      } else {
        this.state.regime = 'RANGING';
      }

      // Calculate SMAs
      const sma50 = prices.length >= 50 ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50 : currentPrice;
      const sma200 = prices.length >= 200 ? prices.slice(-200).reduce((a, b) => a + b, 0) / 200 : currentPrice;

      // Determine phase
      if (currentPrice > sma50 && sma50 > sma200 && trend20 > 5) {
        this.state.phase = 'MARKUP';
      } else if (currentPrice < sma50 && sma50 < sma200 && trend20 < -5) {
        this.state.phase = 'MARKDOWN';
      } else if (vol14 > 2.5 && trend20 < 5 && trend20 > -5) {
        this.state.phase = 'DISTRIBUTION';
      } else {
        this.state.phase = 'ACCUMULATION';
      }

      // Determine sentiment
      if (this.state.phase === 'MARKDOWN' && this.state.volatility > 2.5) {
        this.state.sentiment = 'EXTREME_FEAR';
      } else if (this.state.phase === 'MARKDOWN') {
        this.state.sentiment = 'FEAR';
      } else if (this.state.phase === 'MARKUP' && this.state.volatility > 2.5) {
        this.state.sentiment = 'EXTREME_GREED';
      } else if (this.state.phase === 'MARKUP') {
        this.state.sentiment = 'GREED';
      } else {
        this.state.sentiment = 'NEUTRAL';
      }

      this.state.lastUpdated = new Date().toISOString();
      return this.state;

    } catch (error) {
      console.error('MarketAnalyser error:', error.message);
      return this.getDefaultState();
    }
  }

  getDefaultState() {
    return {
      regime: 'RANGING',
      sentiment: 'NEUTRAL',
      phase: 'ACCUMULATION',
      volatility: 1.5,
      trend: 0,
      volumeRatio: 1,
      btcPrice: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  stdDev(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  getState() { return this.state; }
}

module.exports = MarketAnalyser;
