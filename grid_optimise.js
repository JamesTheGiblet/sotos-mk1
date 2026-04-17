const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

async function test(target, stop, maxVol) {
  const SQL = await initSqlJs();
  const db  = new SQL.Database(fs.readFileSync(DB_PATH));
  const result = db.exec(`
    SELECT timestamp, open, high, low, close
    FROM candles WHERE pair = 'BTC/USD' AND interval = '1D'
    ORDER BY timestamp ASC LIMIT 721
  `);
  db.close();

  const candles = result[0].values.map(r => ({
    timestamp: r[0], open: r[1], high: r[2], low: r[3], close: r[4]
  }));

  let capital = 1000, trades = [], position = null;

  for (let i = 20; i < candles.length; i++) {
    const window = candles.slice(i - 20, i);
    const centre = window.reduce((a, b) => a + b.close, 0) / 20;
    const price  = candles[i].close;
    const pctFromCentre = (price - centre) / centre * 100;

    const rets = window.slice(-14).map((c, j) =>
      j > 0 ? (c.close - window[j-1].close) / window[j-1].close * 100 : 0
    ).filter(r => r !== 0);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vol  = Math.sqrt(rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rets.length);

    if (vol > maxVol) continue;

    if (!position && pctFromCentre <= -0.5) {
      position = { entry: price, target: price * (1 + target/100), stop: price * (1 - stop/100), idx: i };
    } else if (position) {
      const pnl  = (price - position.entry) / position.entry * 100;
      const hold = i - position.idx;
      if (price >= position.target || price <= position.stop || hold >= 3) {
        capital *= (1 + pnl / 100);
        trades.push({ win: pnl > 0 });
        position = null;
      }
    }
  }

  const total = trades.length;
  const wr    = total ? Math.round(trades.filter(t => t.win).length / total * 1000) / 10 : 0;
  const ret   = Math.round((capital - 1000) / 1000 * 1000) / 10;
  return { target, stop, maxVol, total, wr, ret };
}

async function run() {
  console.log('GRID PARAMETER OPTIMISATION');
  console.log('Target% | Stop% | MaxVol% | Trades | WR%  | Return%');
  console.log('-'.repeat(55));

  const variants = [
    [0.5, 0.3, 2.5],
    [1.0, 0.3, 2.5],
    [1.0, 0.5, 2.5],
    [1.0, 0.3, 2.0],
    [1.5, 0.5, 2.0],
    [1.5, 0.3, 1.5],
    [2.0, 0.5, 2.0],
    [2.0, 1.0, 2.5],
  ];

  for (const [t, s, v] of variants) {
    const r = await test(t, s, v);
    const pass = r.wr >= 50 && r.ret > 0 && r.total >= 5 ? '✅' : '❌';
    console.log(`  ${t}%    | ${s}%  | ${v}%     | ${String(r.total).padEnd(6)} | ${String(r.wr).padEnd(4)} | ${r.ret >= 0 ? '+' : ''}${r.ret}%  ${pass}`);
  }
}

run().catch(console.error);
