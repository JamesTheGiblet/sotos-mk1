# Kraken Intelligence

## Adaptive Trading Platform — Giblets Creations

> *"I wanted it. So I forged it. Now forge yours."*

---

## 🎯 What This Is

**An autonomous trading system that validates itself on unseen data before ever trading live.**

Kraken Intelligence is a market-adaptive trading platform built to run completely locally (currently on a Samsung S24 Ultra via Termux). It collects live cryptocurrency data, analyses market conditions, generates and validates trading strategies, and monitors for entry signals without relying on cloud infrastructure.

## 🏛️ The Five Pillars

| Pillar | How KI Delivers |
|--------|-----------------|
| **Cost Control** | Runs on Termux (phone), free API, no cloud |
| **Security** | 3 locks, API keys in `.env`, 30-day dry runs |
| **Quality** | Backtest + forward test (80/20 split), auto-optimization |
| **Efficiency** | 24/7 autonomous, market-adaptive switching |
| **Freedom** | MIT License, SCP portable strategies |

---

## 📊 Current Status

**Running Processes (PM2):**

- `forge-monitor` — Watches for entry conditions every 5 minutes.
- `reasoning-bot` — Selects the best strategy for current market conditions hourly.
- `ki-collector` — Collects daily OHLCV data from Kraken at 6am UTC.

**Strategy Pool (8 strategies):**

- **5 Original Hardcoded Strategies:** Smart BTC, Momentum, Grid, Breakout, Mean Reversion.
- **3 Forge-Validated Strategies:**
  - *H.E Consecutive Red + RSI* — 62.5% WR, +41.5% return
  - *H.E Mean Reversion Bollinger* — 56.3% WR, +45.2% return
  - *H.E Oversold Bounce* — 56.3% WR, +41.9% return

**Current Market Conditions (as of 2026-04-15):**

- **Regime:** RANGING / ACCUMULATION
- **BTC Price:** ~$74,000
- **Sentiment:** NEUTRAL
- **Monitor Status:** Watching (no entry conditions met yet)

---

## 🛡️ Why This Exists & Security

| Problem | How Kraken Intelligence Solves It |
|---------|-----------------------------------|
| **Non-adaptive strategies** | Adaptive allocator switches by market regime |
| **No forward testing** | Validation pipeline tests on 20% unseen data |
| **Untested before live** | Mandatory 30-day dry run |
| **API key leaks** | Three locks system, keys in `.env` |
| **No strategy portability** | SCP (Semantic Capsule Protocol) |

### The Three Locks

```text
Lock 1: 30 days dry run ─────► Cannot bypass
Lock 2: Validation (≥55% WR) ► Auto-tested
Lock 3: API key in .env ─────► User controlled
```

---

## 🔄 The Forge Loop

The core intelligence cycle:

```text
forge-reasoning.js   →  Generates hypothesis from market state + failure memory
forge-validator.js   →  Backtests against real Kraken data, honest pass/fail gate
forge_auto.js        →  Runs loop until a strategy passes
forge-monitor.js     →  Watches for live entry conditions via PM2
```

Pass criteria: Win rate ≥ 50%, positive return, minimum 5 trades.

Failed strategies are stored in `reasoning-bot/data/validation_failures.json` and inform the next hypothesis.

---

## 🏗️ Architecture

```text
~/kraken-intelligence/
├── forge-reasoning.js     — Hypothesis generation
├── forge-validator.js     — Hardcoded rule backtest engine
├── forge-monitor.js       — Live entry condition watcher
├── forge_auto.js          — Automated generate/validate loop
├── collect.js             — Daily OHLCV data collection
├── analyse.js             — Pattern finder, regime classifier
├── reasoning-bot/         — Market analyser + strategy selector
│   ├── market_analyser.js
│   ├── strategy_selector.js
│   └── data/
│       ├── reasoning_bot.db
│       ├── validation_failures.json
│       └── monitor_log.json
├── tools/                 — 9 Integrated tools
├── data/
│   └── intelligence.db    — 721+ daily candles, 10+ pairs
└── cce/engines/scp/       — Validated strategy capsules
```

---

## Known Limitations

- Backtest results come from the same 721 historical candles — forward performance may differ
- The monitor has not yet caught a live entry signal (market conditions currently ranging/neutral)
- The 30-day dry run gate in Aegis is a counter, not 30 actual days of trading
- Strategy pool previously accumulated duplicates — resolved 2026-04-15

---

## Quick Commands

```bash
# Check what's running
pm2 list

# See monitor activity
pm2 logs forge-monitor --lines 20

# Generate and validate a new strategy
node forge_auto.js 5

# Single monitor check
node forge-monitor.js --once

# Run reasoning bot once
cd reasoning-bot && node -e "const b = new (require('./index'))(); b.runOnce();"

# Platform Status
./platform-status.sh
```

---

## Part of the Adaptive Intelligence Platform

Kraken Intelligence is one tool in the broader Adaptive Intelligence Platform — a suite built around cost control, security, quality, efficiency, and sovereignty.

Other tools: Whisper, Aegis, EmbedID, MarkFlow, CertiScope, TreeCraft, Test Generator, Chameleon LM, Praximous.

---

*Giblets Creations — James Gilbert*
*Built on Samsung S24 Ultra via Termux*
*April 2026*
