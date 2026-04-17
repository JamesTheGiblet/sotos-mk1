# Kraken Intelligence — Complete System Documentation

## Overview

Kraken Intelligence is a comprehensive cryptocurrency trading system that:
1. Collects historical OHLCV data from Kraken
2. Discovers profitable trading patterns using random search
3. Validates strategies through backtesting and forward simulation
4. Runs live dry-run monitors for validated strategies
5. Provides web dashboards for real-time monitoring

**Current Status:** 🟢 Production Ready (Dry Run Mode)
**Last Updated:** April 9, 2026
**Location:** `~/kraken-intelligence/` and `~/cce/engines/`

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
│                    ┌─────────────────────┐                                  │
│                    │ Three Asset Portfolio│                                  │
│                    │   (Production)       │                                  │
│                    └─────────────────────┘                                  │
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
├── collect.js                 # OHLCV data collector (19 pairs, 3 intervals)
├── analyse.js                 # Analysis engine with backtests
├── cli.js                     # Command-line interface
├── package.json               # Dependencies
│
├── data/
│   └── intelligence.db        # SQLite database (40,568 candles)
│
├── rules/
│   ├── engine.js              # Rule evaluation engine
│   ├── strategies.json        # All discovered strategies
│   └── schema.json            # JSON schema for rules
│
├── optimization/
│   ├── optimizer.js           # Grid search optimizer
│   ├── discovery.js           # Random strategy discovery
│   └── discovery_4h.js        # 4H/1H timeframe discovery
│
├── strategies/
│   ├── discovered.json        # All discovered strategies
│   ├── 4H/discovered_4H.json  # 4H timeframe discoveries
│   └── 1H/discovered_1H.json  # 1H timeframe discoveries
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
│
├── dashboard/
│   ├── index.html             # Web dashboard UI
│   └── api.js                 # API server for dashboard
│
└── docs/
├── COMPLETE_SYSTEM.md     # This file
├── SE_THREE_RED.md        # Original strategy spec
├── TE_HOUR20.md           # Hour20 strategy design
└── INTRADAY_FINDINGS.md   # 1H analysis results

~/cce/engines/
├── four-red-days/             # Original single-asset engine
│   ├── manifest.json
│   ├── engine.js
│   └── dryrun.log
│
└── three-asset-portfolio/     # Production portfolio engine
├── manifest.json
├── engine.js
├── monitor.js
├── portfolio_state.json
├── dryrun.log
├── daily_log.txt
└── daily_report.sh

```

---

## Core Components

### 1. Data Collection (`collect.js`)

**Purpose:** Fetches OHLCV data from Kraken public API

**Schedule:** Daily at 6:00 AM UTC (via PM2 cron)

**Pairs Collected (19):**
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

**Database Size:** 40,568 candles

### 2. Strategy Discovery Engine (`optimization/discovery.js`)

**Purpose:** Random search for profitable trading strategies

**Algorithm:**
1. Generate random strategy with 1-3 conditions
2. Random parameters (target%, stop%, hold days)
3. Backtest on historical candles
4. Keep strategies with ≥8 trades, ≥55% win rate, positive return

**Indicators Available:**
- consecutive (red/green candles)
- change (price change over periods)
- rsi (Relative Strength Index)
- volume (volume vs average)
- zscore (mean reversion)
- volatility (volatility comparison)

**Discovery Results:**
- BTC: 66 viable strategies
- ETH: 66 viable strategies
- SOL: 62 viable strategies
- DOGE: 65 viable strategies
- 4H: 21 viable strategies
- 1H: 8 viable strategies

### 3. Three Asset Portfolio Engine (`~/cce/engines/three-asset-portfolio/`)

**Purpose:** Production trading engine for validated strategies

**Assets & Allocations:**
| Asset | Allocation | Strategy |
|-------|------------|----------|
| LINK/USD | 40% | 4 red days |
| BTC/USD | 40% | 4 red days |
| LTC/USD | 20% | 4 red days |

**Strategy Parameters:**
```javascript
{
  requiredRed: 4,      // Need 4 consecutive red days
  targetPct: 1,        // Take profit at +1%
  stopPct: 0.75,       // Stop loss at -0.75%
  maxHoldDays: 5       // Exit after 5 days
}
```

Performance (Backtest + Forward):

Metric Backtest (80%) Forward (20%)
Return +32.7% +23.4%
Win Rate 74.6% 84%
Trades 37 20

Current Live Dry Run:

· Total Trades: 72
· Win Rate: 75.0%
· Capital: $406.96 (+62.8% from $250)

4. Live Monitor (monitor.js)

Purpose: Runs engine continuously on live data (dry run mode)

Features:

· Checks for new candles every 5 minutes
· Persistent state across restarts
· Only processes new candles (index-based)
· Logs all activity to dryrun.log
· PM2-managed for persistence

5. Web Dashboard (dashboard/)

Access: http://localhost:8080

Features:

· Real-time capital and trade stats
· Capital growth chart
· Win/loss distribution donut
· Recent trades table
· Daily log table
· Signal alert for 4+ red days
· Auto-refresh every 30 seconds

6. Rule Engine (rules/engine.js)

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

---

PM2 Processes

Name Script Purpose Restart
ki-collector collect.js Daily data collection Cron (6am UTC)
three-asset-portfolio monitor.js Live strategy monitoring Always
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
0 6 * * *   # Daily: ki-collector (via PM2)
0 7 * * *   # Daily: daily_capture.sh
0 8 * * 0   # Weekly: generate_30day_report.sh
0 8 * * *   # Daily: three-asset-portfolio daily_report.sh
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

Daily Operation Schedule (UTC)

Time Event Component
00:00 - 06:00 Monitor checks every 5 min monitor.js
06:00 Data collection runs collect.js (PM2 cron)
06:01 New candle added to DB SQLite
06:05 Monitor detects new candle monitor.js
06:06 Engine processes candle ThreeAssetPortfolio
07:00 Daily report captured daily_capture.sh (cron)
08:00 Portfolio daily report daily_report.sh (cron)

---

Useful Commands

Daily Maintenance

```bash
# Check all systems
pm2 status

# View portfolio status
tail -20 ~/cce/engines/three-asset-portfolio/dryrun.log

# View dashboard (from Termux)
termux-open-url http://localhost:8080

# View current portfolio state
cat ~/cce/engines/three-asset-portfolio/portfolio_state.json | jq '.stats'
```

Manual Operations

```bash
# Run data collection manually
node ~/kraken-intelligence/collect.js

# Run discovery (500 random strategies)
node ~/kraken-intelligence/optimization/discovery.js

# Generate 30-day report
~/kraken-intelligence/reports/generate_30day_report.sh

# Compare all strategies
node ~/kraken-intelligence/cli.js compare
```

Portfolio Management

```bash
# Restart portfolio monitor
pm2 restart three-asset-portfolio

# View live logs
pm2 logs three-asset-portfolio --lines 50

# View daily reports
cat ~/cce/engines/three-asset-portfolio/daily_log.txt
```

---

Troubleshooting

Portfolio not detecting new candles

```bash
# Check if collection is running
pm2 logs ki-collector --lines 10

# Check database has new candles
sqlite3 ~/kraken-intelligence/data/intelligence.db \
  "SELECT COUNT(*) FROM candles WHERE interval='1D'"

# Restart monitor
pm2 restart three-asset-portfolio
```

Dashboard not loading

```bash
# Check if running
pm2 status four-red-days-dashboard

# Restart
pm2 restart four-red-days-dashboard

# Check logs
pm2 logs four-red-days-dashboard --lines 20
```

State corruption

```bash
# Backup current state
cp ~/cce/engines/three-asset-portfolio/portfolio_state.json \
   ~/cce/engines/three-asset-portfolio/portfolio_state.json.bak

# Reset state (starts fresh with $250)
rm ~/cce/engines/three-asset-portfolio/portfolio_state.json

# Restart monitor
pm2 restart three-asset-portfolio
```

---

Performance Metrics (as of April 9, 2026)

Metric Value
Total Candles 40,568
Database Size ~4 MB
Pairs Collected 19
Intervals 3 (1D, 4H, 1H)
Strategies Discovered 114+
Portfolio Trades 72
Portfolio Win Rate 75.0%
Portfolio Return +62.8%
Portfolio Capital $406.96
PM2 Processes 3 active

---

Version History

Version Date Changes
1.0.0 2026-04-07 Initial collector and analysis
1.1.0 2026-04-08 Rule engine and strategy discovery
1.2.0 2026-04-09 Live monitor, daily reports, dashboard
1.3.0 2026-04-09 Four Red Days production engine
2.0.0 2026-04-09 Three Asset Portfolio (LINK + BTC + LTC)

---

Next Steps

1. Let system run for 30 days - Automatic data collection and monitoring
2. Check dashboard daily - Monitor for signals and performance
3. Review 30-day report - Compare forward vs backtest results
4. Decision point - Flip to LIVE if edge holds

---

Contact

Author: Giblets Creations
System: Kraken Intelligence v2.0.0
Status: Production Ready (Dry Run)

"I wanted it. So I forged it. Now forge yours."

