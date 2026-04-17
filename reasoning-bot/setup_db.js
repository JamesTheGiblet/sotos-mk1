const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function setup() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  
  // Create all tables
  db.run(`CREATE TABLE market_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    regime TEXT NOT NULL,
    phase TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    volatility REAL,
    trend REAL,
    volume_ratio REAL,
    btc_price REAL
  )`);

  db.run(`CREATE TABLE strategy_selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    strategy_name TEXT NOT NULL,
    score INTEGER,
    target_pct REAL,
    stop_pct REAL,
    hold_days REAL,
    reasoning TEXT,
    market_state_id INTEGER
  )`);

  db.run(`CREATE TABLE strategy_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    from_strategy TEXT,
    to_strategy TEXT,
    reason TEXT,
    market_state_id INTEGER
  )`);

  db.run(`CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    severity TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    acknowledged INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    summary TEXT NOT NULL,
    dominant_strategy TEXT,
    avg_volatility REAL,
    avg_sentiment TEXT
  )`);

  // Save to file
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  
  const dbBuffer = db.export();
  fs.writeFileSync(path.join(dataDir, 'reasoning_bot.db'), dbBuffer);
  
  console.log('✅ Database created with all tables');
  
  // Verify tables exist
  const verify = new SQL.Database(dbBuffer);
  const tables = verify.exec("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('Tables created:');
  tables[0].values.forEach(t => console.log(`  - ${t[0]}`));
  verify.close();
  
  db.close();
}

setup().catch(console.error);
