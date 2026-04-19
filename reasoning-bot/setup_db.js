const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

async function setup() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  
  const db = new Database(path.join(dataDir, 'reasoning_bot.db'));
  db.pragma('journal_mode = WAL');
  
  db.exec(`CREATE TABLE IF NOT EXISTS market_states (
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

  db.exec(`CREATE TABLE IF NOT EXISTS strategy_selections (
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

  db.exec(`CREATE TABLE IF NOT EXISTS strategy_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    from_strategy TEXT,
    to_strategy TEXT,
    reason TEXT,
    market_state_id INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    severity TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    acknowledged INTEGER DEFAULT 0
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    summary TEXT NOT NULL,
    dominant_strategy TEXT,
    avg_volatility REAL,
    avg_sentiment TEXT
  )`);

  console.log('✅ Database created with all tables');
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables created:');
  tables.forEach(t => console.log(`  - ${t.name}`));
  
  db.close();
}

setup().catch(console.error);
