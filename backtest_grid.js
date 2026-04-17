/**
 * Grid Trading Backtest
 * Tests how grid trading performs on historical BTC/USD daily candles
 * Grid logic: buy when price drops X% from centre, sell when it recovers
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

async function backtest() {
  const SQL = await initSqlJs();
  const db  = new SQL.Database(fs.readFileSync(DB_PATH));

  const result = db.exec(`
    SELECT timestamp, open, high, low, close, volume
    FROM candles WHERE pair = 'BTC/USD' AND interval = '1D'
    ORDER BY timestamp ASC LIMIT 721
  `);
  db.close();

  const candles = result[0].values.map(r => ({
    timestamp: r[0], open: r[1], high: r[2],
    low: r[3], close: r[4], volume: r[5]
  }));

  // Grid parameters
  const GRID_SPACING = 0.5;  // % between grid levels
  const STOP_PCT     = 0.3;  // % stop loss
  const LEVELS       = 5;    // grid levels each side
  const CAPITAL      = 1000;

  let capital    = CAPITAL;
  let trades     = [];
  let position   = null;

  // Use 20-day rolling centre price
  for (let i = 20; i < candles.length; i++) {
    const window  = candles.slice(i - 20, i);
    const centre  = window.reduce((a, b) => a + b.close, 0) / 20;
    const price   = candles[i].close;
    const pctFromCentre = (price - centre) / centre * 100;
    const vol14   = (() => {
      const rets = window.slice(-14).map((c, j) =>
        j > 0 ? (c.close - window[j-1].close) / window[j-1].close * 100 : 0
      ).filter(r => r !== 0);
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      return Math.sqrt(rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rets.length);
    })();

    // Only trade in low volatility ranging conditions
    if (vol14 > 2.5) continue;

    if (!position) {
      // Enter when price drops more than one grid level below centre
      if (pctFromCentre <= -GRID_SPACING) {
        position = {
          entry:    price,
          target:   price * (1 + GRID_SPACING / 100),
          stop:     price * (1 - STOP_PCT / 100),
          centre,
          idx: i
        };
      }
    } else {
      const hold = i - position.idx;
      const pnl  = (price - position.entry) / position.entry * 100;

      if (price >= position.target || price <= position.stop || hold >= 3) {
        capital *= (1 + pnl / 100);
        trades.push({
          pnl:    Math.round(pnl * 100) / 100,
          win:    pnl > 0,
          hold,
          reason: price >= position.target ? 'target' : price <= position.stop ? 'stop' : 'timeout'
        });
        position = null;
      }
    }
  }

  const total  = trades.length;
  const wins   = trades.filter(t => t.win).length;
  const wr     = total ? Math.round(wins / total * 1000) / 10 : 0;
  const ret    = Math.round((capital - CAPITAL) / CAPITAL * 1000) / 10;
  const avgHold = total ? Math.round(trades.reduce((a, b) => a + b.hold, 0) / total * 10) / 10 : 0;

  console.log('GRID TRADING BACKTEST RESULTS');
  console.log('==============================');
  console.log('Trades:     ' + total);
  console.log('Win Rate:   ' + wr + '%');
  console.log('Return:     ' + (ret >= 0 ? '+' : '') + ret + '%');
  console.log('Capital:    $' + Math.round(capital * 100) / 100);
  console.log('Avg Hold:   ' + avgHold + ' days');
  console.log('');
  console.log('Exit breakdown:');
  ['target','stop','timeout'].forEach(r => {
    const n = trades.filter(t => t.reason === r).length;
    console.log('  ' + r + ': ' + n);
  });
}

backtest().catch(console.error);
