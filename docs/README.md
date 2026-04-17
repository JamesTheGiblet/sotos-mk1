# Kraken Intelligence — Complete System Documentation

## Overview

Kraken Intelligence is a standalone data collection, strategy discovery, and automated trading analysis system. It collects OHLCV data from Kraken, discovers profitable trading patterns through random search, validates strategies via backtesting and forward simulation, and runs live dry-run monitors with a web dashboard.

**Status:** 🟢 Production Ready (Dry Run Mode)
**Location:** `~/kraken-intelligence/`
**Current Strategy:** Four Red Days (4 consecutive red candles → long entry)

---

## System Architecture

```

┌─────────────────────────────────────────────────────────────────────────────┐
│                         KRAKEN INTELLIGENCE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  collect.js  │───▶│   SQLite     │◀───│  analyse.js  │                   │
│  │  (Data)      │    │  Database    │    │  (Analysis)  │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│         │                   │                   │                           │
│         ▼                   ▼                   ▼                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  Discovery   │    │   Rules      │    │  Optimizer   │                   │
│  │  Engine      │───▶│  Engine      │◀───│  (Grid/GA)   │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│         │                   │                   │                           │
│         └───────────────────┼───────────────────┘                           │
│                             ▼                                               │
│                    ┌──────────────┐                                         │
│                    │ Four Red Days│                                         │
│                    │   Engine     │                                         │
│                    │  (Production)│                                         │
│                    └──────────────┘                                         │
│                             │                                               │
│         ┌───────────────────┼───────────────────┐                          │
│         ▼                   ▼                   ▼                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  Live        │    │  Daily       │    │  Dashboard   │                   │
│  │  Monitor     │    │  Reports     │    │  (Web UI)    │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

```

---

## File Structure

```

~/kraken-intelligence/
├── collect.js                 # OHLCV data collector
├── analyse.js                 # Analysis engine with backtests
├── cli.js                     # Command-line interface
├── package.json               # Dependencies
│
├── data/
│   └── intelligence.db        # SQLite database (candles)
│
├── rules/
│   ├── engine.js              # Rule evaluation engine
│   ├── strategies.json        # All discovered strategies
│   └── schema.json            # JSON schema for rules
│
├── optimization/
│   ├── optimizer.js           # Grid search optimizer
│   └── discovery.js           # Random strategy discovery
│
├── strategies/
│   ├── discovered.json        # All discovered strategies
│   ├── 4H/
│   │   └── discovered_4H.json # 4H timeframe discoveries
│   └── 1H/
│       └── discovered_1H.json # 1H timeframe discoveries
│
├── dryrun/
│   ├── live_monitor.js        # Live monitoring daemon
│   ├── engine_state.json      # Persistent engine state
│   ├── monitor.log            # Monitor process log
│   └── manage.sh              # Start/stop/status script
│
├── reports/
│   ├── daily_capture.sh       # Daily data capture script
│   ├── generate_30day_report.sh # 30-day evaluation
│   ├── daily_status.sh        # Quick status display
│   ├── daily_log.txt          # Daily summary log
│   └── daily/                 # Daily JSON reports
│       ├── YYYY-MM-DD_report.json
│       └── latest.json
│
├── dashboard/
│   ├── index.html             # Web dashboard UI
│   └── api.js                 # API server for dashboard
│
└── docs/
├── README.md              # This file
├── SE_THREE_RED.md        # Strategy spec
├── TE_HOUR20.md           # Hour20 strategy design
└── INTRADAY_FINDINGS.md   # 1H analysis results

```

---

## Core Components

### 1. Data Collection (`collect.js`)

**Purpose:** Fetches OHLCV data from Kraken public API

**Schedule:** Daily at 6:00 AM UTC (via PM2 cron)

**Features:**
- No API keys required
- Paginates through all available history
- `INSERT OR IGNORE` prevents duplicates
- Persists after every pair (crash-safe)

**Pairs Collected:**
- BTC/USD, BTC/USDC
- ETH/USD, ETH/USDC, ETH/BTC
- SOL/USD, SOL/USDC
- XRP/USD, XRP/USDC
- LTC/USD, LTC/USDC
- ADA/USD, ADA/USDC
- LINK/USD, LINK/USDC
- DOT/USD, DOT/USDC
- DOGE/USD, DOGE/USDC

**Intervals:** 1D, 4H, 1H

**Database Schema:**
```sql
CREATE TABLE candles (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  pair      TEXT    NOT NULL,
  interval  TEXT    NOT NULL,
  timestamp INTEGER NOT NULL,
  open      REAL    NOT NULL,
  high      REAL    NOT NULL,
  low       REAL    NOT NULL,
  close     REAL    NOT NULL,
  volume    REAL    NOT NULL,
  trades    INTEGER,
  UNIQUE(pair, interval, timestamp)
);
```

2. Rule Engine (rules/engine.js)

Purpose: Evaluates trading rules against candle data

Available Indicators:

Indicator Description Parameters
price Compare price to value compare, value
change Price change over periods periods, compare, value
consecutive Consecutive red/green candles count, direction
rsi RSI value comparison period, compare, value
ma Moving average comparison period, compare, value
volume Volume vs average period, compare, multiplier
volatility Volatility comparison period, compare, value
zscore Z-score (mean reversion) period, compare, value
time Time of day/week hour, minute, dayOfWeek
pattern Candlestick patterns name (hammer, engulfing, doji)
and Logical AND of conditions conditions
or Logical OR of conditions conditions
not Logical NOT condition

Key Functions:

```javascript
// Evaluate a condition
engine.evaluateCondition(candles, index, condition)

// Backtest a strategy
engine.backtest(candles, strategy, initialCapital)

// Calculate metrics
engine.calculateRSI(prices, period)
engine.zscore(value, array)
```

3. Strategy Discovery (optimization/discovery.js)

Purpose: Random search for profitable trading strategies

Algorithm:

1. Generate random strategy with 1-3 conditions
2. Random parameters (target%, stop%, hold days)
3. Backtest on 721 daily candles
4. Keep strategies with ≥8 trades, ≥55% win rate, positive return

Output: strategies/discovered.json with all viable strategies

Sample Discovery Result:

```json
{
  "strategy": {
    "name": "discovered_xxx",
    "entryRules": {
      "type": "and",
      "conditions": [
        { "type": "consecutive", "params": { "count": 4, "direction": "red" } }
      ]
    },
    "params": { "targetPct": 1, "stopPct": 0.75, "maxHoldDays": 5 }
  },
  "result": {
    "trades": 29,
    "winRate": 79.3,
    "totalReturn": 74.1,
    "sharpe": 0.89
  }
}
```

4. Four Red Days Engine (~/cce/engines/four-red-days/)

Purpose: Production trading engine for the validated strategy

Strategy Parameters:

```javascript
{
  requiredRed: 4,      // Need 4 consecutive red days
  targetPct: 1,        // Take profit at +1%
  stopPct: 0.75,       // Stop loss at -0.75%
  maxHoldDays: 5       // Exit after 5 days
}
```

State Machine:

```
IDLE → (4 red days) → ENTER → HOLDING → (target/stop/timeout) → EXIT → IDLE
```

Persistent State: engine_state.json

```json
{
  "capital": 165.56,
  "trades": [...],
  "position": null,
  "consecutiveRed": 0,
  "lastProcessedIndex": 720
}
```

5. Live Monitor (dryrun/live_monitor.js)

Purpose: Runs engine continuously on live data (dry run mode)

Features:

· Checks for new candles every 5 minutes
· Persistent state across restarts
· Only processes new candles (index-based)
· Logs all activity to dryrun.log

PM2 Process: four-red-days-monitor

6. Daily Reports (reports/)

Components:

File Purpose Schedule
daily_capture.sh Captures daily data to JSON 7:00 AM UTC
generate_30day_report.sh Generates evaluation report Weekly (Sunday 8am)
daily_status.sh Quick terminal status Manual

Daily Report JSON Structure:

```json
{
  "date": "2026-04-09",
  "capital": 165.56,
  "trades": 26,
  "btc_price": 71341,
  "signal_active": false,
  "consecutive_red": 0,
  "daily_pnl": 0,
  "daily_return": 0,
  "last_trades": [...]
}
```

7. Web Dashboard (dashboard/)

Components:

File Purpose Port
api.js Express-like HTTP server 8080
index.html Dashboard UI Served by api.js

API Endpoints:

· GET / → Dashboard HTML
· GET /api/status → JSON with all metrics

Dashboard Features:

· Real-time capital and trade stats
· Capital growth chart
· Win/loss distribution donut
· Recent trades table
· Daily log table
· Signal alert for 4+ red days
· Auto-refresh every 30 seconds

PM2 Process: four-red-days-dashboard

8. CLI Interface (cli.js)

Commands:

```bash
node cli.js list                    # List all strategies
node cli.js test <strategy>         # Test a specific strategy
node cli.js compare                 # Compare all strategies
node cli.js optimize <strategy>     # Optimize strategy parameters
node cli.js discover                # Run discovery (manual)
```

---

PM2 Processes

Name Script Purpose Restart
ki-collector collect.js Daily data collection Cron (6am UTC)
four-red-days-monitor dryrun/live_monitor.js Live strategy monitoring Always
four-red-days-dashboard dashboard/api.js Web dashboard Always

PM2 Commands:

```bash
pm2 list                           # List all processes
pm2 logs <name>                    # View logs
pm2 restart <name>                 # Restart process
pm2 stop <name>                    # Stop process
pm2 start <name>                   # Start process
pm2 save                           # Save current configuration
```

---

Cron Jobs

```bash
# View all cron jobs
crontab -l

# Jobs:
0 2 * * 0   # Weekly: cce-fl-engine
0 2 * * *   # Daily: cce-audit-engine
*/15 * * * * # Every 15min: cce-go-engine
0 6 * * *   # Daily: ki-collector (via PM2)
0 7 * * *   # Daily: daily_capture.sh
0 8 * * 0   # Weekly: generate_30day_report.sh
```

---

Discovered Strategies (Top 10)

Rank Name Trades Win Rate Return Sharpe Entry Rules
1 four_red_days 29 79.3% +74.1% 0.89 4 consecutive red
2 eh3g6y 29 82.8% +69.4% 0.90 4 red days (tight)
3 three_red 47 60.0% +54.0% 0.27 3 red days + drop
4 wp1xga 27 74.1% +53.7% 0.55 4 red days (2% target)
5 gqajp3 10 70.0% +52.7% 0.68 Volume + Z-score
6 zscore_reversion 79 58.2% +23.7% 0.10 Z-score < -1
7 three_red_volume 13 76.9% +24.0% 0.44 3 red + volume
8 qpmcb7 27 63.0% +12.0% 0.12 Z-score + consecutive
9 emz7dv 57 51.0% +34.0% 0.16 Change + consecutive
10 f2i1vk 29 52.0% -12.0% -0.10 (FAILED forward test)

---

Key Functions Reference

RuleEngine Class (rules/engine.js)

```javascript
const RuleEngine = require('./rules/engine');
const engine = new RuleEngine();

// Evaluate a condition
const result = engine.evaluateCondition(candles, i, condition);

// Backtest a strategy
const backtest = engine.backtest(candles, strategy, initialCapital);

// Calculate indicators
const rsi = engine.calculateRSI(prices, 14);
const z = engine.zscore(value, array);
const isHammer = engine.isHammer(candle);
```

StrategyOptimizer Class (optimization/optimizer.js)

```javascript
const optimizer = new StrategyOptimizer(dbPath);
await optimizer.init();

// Grid search optimization
const best = await optimizer.optimizeStrategy('four_red_days', {
  targetPct: [1, 1.5, 2],
  stopPct: [0.5, 0.75, 1],
  maxHoldDays: [3, 5, 7]
});
```

StrategyDiscovery Class (optimization/discovery.js)

```javascript
const discovery = new StrategyDiscovery(dbPath);
await discovery.init();

// Find new strategies
const strategies = await discovery.discover(
  minTrades = 8,
  minWinRate = 55,
  iterations = 500
);
```

FourRedDays Class (~/cce/engines/four-red-days/engine.js)

```javascript
const engine = new FourRedDays({
  status: 'dry_run',  // or 'live'
  capital: 100
});

// Process a new candle
engine.onCandle({
  timestamp: '2026-04-09T00:00:00Z',
  open: 70000,
  close: 69500,
  high: 70200,
  low: 69300,
  volume: 1000
});

// Get current stats
const stats = engine.getStats();
// { trades, wins, losses, winRate, capital, totalReturn }
```

---

Database Queries

Get candles for a pair

```sql
SELECT timestamp, open, high, low, close, volume
FROM candles
WHERE pair = 'BTC/USD' AND interval = '1D'
ORDER BY timestamp ASC;
```

Get latest candle

```sql
SELECT * FROM candles
WHERE pair = 'BTC/USD' AND interval = '1D'
ORDER BY timestamp DESC LIMIT 1;
```

Get consecutive red count

```sql
SELECT close, open FROM candles
WHERE pair = 'BTC/USD' AND interval = '1D'
ORDER BY timestamp DESC LIMIT 5;
```

---

Dashboard Access

Local Access

```
http://localhost:8080
```

Network Access

```bash
# Get your IP address
ip addr show wlan0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}'

# Access from another device
http://YOUR_IP:8080
```

API Direct Access

```bash
# Get full status JSON
curl http://localhost:8080/api/status | jq '.'

# Get just capital and win rate
curl -s http://localhost:8080/api/status | jq '{capital, win_rate, trades}'
```

---

Daily Operation Schedule (UTC)

Time Event Component
00:00 - 06:00 Monitor checks every 5 min live_monitor.js
06:00 Data collection runs collect.js (PM2 cron)
06:01 New candle added to DB SQLite
06:05 Monitor detects new candle live_monitor.js
06:06 Engine processes candle FourRedDays
07:00 Daily report captured daily_capture.sh (cron)

---

Useful Commands

Daily Maintenance

```bash
# Check all systems
pm2 status

# View dashboard status
~/kraken-intelligence/reports/daily_status.sh

# Watch engine log
tail -f ~/cce/engines/four-red-days/dryrun.log

# Watch monitor log
tail -f ~/kraken-intelligence/dryrun/monitor.log
```

Manual Operations

```bash
# Run data collection manually
node ~/kraken-intelligence/collect.js

# Run analysis
node ~/kraken-intelligence/analyse.js

# Run discovery (500 random strategies)
node ~/kraken-intelligence/optimization/discovery.js

# Generate 30-day report
~/kraken-intelligence/reports/generate_30day_report.sh

# Compare all strategies
node ~/kraken-intelligence/cli.js compare
```

PM2 Management

```bash
# View all processes
pm2 list

# View logs
pm2 logs --lines 50

# Restart all
pm2 restart all

# Save configuration
pm2 save

# Monitor CPU/memory
pm2 monit
```

---

Troubleshooting

Dashboard not loading

```bash
# Check if running
pm2 status four-red-days-dashboard

# Restart
pm2 restart four-red-days-dashboard

# Check logs
pm2 logs four-red-days-dashboard --lines 20
```

Monitor not detecting candles

```bash
# Check if collecting
pm2 logs ki-collector --lines 10

# Check database has new candles
sqlite3 ~/kraken-intelligence/data/intelligence.db \
  "SELECT COUNT(*) FROM candles WHERE interval='1D'"

# Restart monitor
pm2 restart four-red-days-monitor
```

Engine state corruption

```bash
# Backup current state
cp ~/kraken-intelligence/dryrun/engine_state.json ~/kraken-intelligence/dryrun/engine_state.json.bak

# Reset state (starts fresh with $100)
rm ~/kraken-intelligence/dryrun/engine_state.json

# Restart monitor
pm2 restart four-red-days-monitor
```

---

Performance Metrics (as of April 9, 2026)

Metric Value
Total Candles 721 (2 years)
Database Size 3.8 MB
Four Red Days Trades 26
Win Rate 76.9%
Total Return +65.6%
Average Win +3.01%
Average Loss -1.45%
Average Hold 1 day
Current Capital $165.56
Strategies Discovered 58
PM2 Processes 3

---

Version History

Version Date Changes
1.0.0 2026-04-07 Initial collector and analysis
1.1.0 2026-04-08 Rule engine and strategy discovery
1.2.0 2026-04-09 Live monitor, daily reports, dashboard
1.3.0 2026-04-09 Four Red Days production engine

---

Next Steps

1. Let system run for 30 days - Automatic data collection and monitoring
2. Check dashboard daily - Monitor for signals and performance
3. Review 30-day report - Compare forward vs backtest results
4. Decision point - Flip to LIVE if edge holds

---

Contact

Author: Giblets Creations
System: Kraken Intelligence v1.3.0
Status: Production Ready (Dry Run)

"I wanted it. So I forged it. Now forge yours."

