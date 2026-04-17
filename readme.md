# Kraken Intelligence
### Adaptive Trading Platform — Giblets Creations

> *"I wanted it. So I forged it. Now forge yours."*

---

## What This Is

Kraken Intelligence is a market-adaptive trading platform running on a Samsung S24 Ultra via Termux. It collects live cryptocurrency data, analyses market conditions, generates and validates trading strategies, and monitors for entry signals — all locally, no cloud.

---

## Current Status

**Running (PM2):**
- `forge-monitor` — watches for entry conditions every 5 minutes
- `reasoning-bot` — selects the best strategy for current market conditions hourly
- `ki-collector` — collects daily OHLCV data from Kraken at 6am UTC

**Strategy Pool (8 strategies):**
- 5 original hardcoded strategies (smart_btc, momentum, grid, breakout, mean_reversion)
- 3 Forge-validated strategies:
  - H.E Consecutive Red + RSI — 62.5% WR, +41.5% return
  - H.E Mean Reversion Bollinger — 56.3% WR, +45.2% return
  - H.E Oversold Bounce — 56.3% WR, +41.9% return

**Current market (2026-04-15):**
- Regime: RANGING / ACCUMULATION
- BTC: ~$74,000
- Sentiment: NEUTRAL
- Monitor status: watching, no entry conditions met yet

---

## Why This Exists

| Problem | Solution |
|---------|----------|
| Fixed strategies that don't adapt | Reasoning bot selects strategy by market regime |
| No validation before deployment | Forge validator backtests against 721 real candles |
| No learning from failures | Failure memory feeds next hypothesis generation |
| Untested before live | Monitor runs in dry run mode first |
| No strategy portability | SCP (Semantic Capsule Protocol) |

---

## The Forge Loop

The core intelligence cycle:

```
forge-reasoning.js   →  generates hypothesis from market state + failure memory
forge-validator.js   →  backtests against real Kraken data, honest pass/fail gate
forge_auto.js        →  runs loop until a strategy passes
forge-monitor.js     →  watches for live entry conditions via PM2
```

Pass criteria: Win rate ≥ 50%, positive return, minimum 5 trades.

Failed strategies are stored in `reasoning-bot/data/validation_failures.json` and inform the next hypothesis.

---

## Integrated Tools (9)

| Tool | Purpose | Status |
|------|---------|--------|
| Whisper | Security scanning | MVP |
| Aegis | Compliance checks | MVP |
| SCP | Strategy portability | Live |
| EmbedID | Code watermarking | MVP |
| MarkFlow | Documentation generator | MVP |
| CertiScope | Web credibility scoring | MVP |
| Test Generator | Automated test creation | MVP |
| TreeCraft | Project structure analysis | MVP |
| Chameleon LM | Domain expertise adapter | MVP |

---

## Architecture

```
~/kraken-intelligence/
├── forge-reasoning.js     — hypothesis generation
├── forge-validator.js     — hardcoded rule backtest engine
├── forge-monitor.js       — live entry condition watcher
├── forge_auto.js          — automated generate/validate loop
├── collect.js             — daily OHLCV data collection
├── analyse.js             — pattern finder, regime classifier
├── reasoning-bot/         — market analyser + strategy selector
│   ├── market_analyser.js
│   ├── strategy_selector.js
│   └── data/
│       ├── reasoning_bot.db
│       ├── validation_failures.json
│       └── monitor_log.json
├── tools/                 — 9 integrated tools
├── data/
│   └── intelligence.db    — 721+ daily candles, 10+ pairs
└── cce/engines/scp/       — validated strategy capsules
```

---

## Honest Limitations

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
```

---

## Part of the Adaptive Intelligence Platform

Kraken Intelligence is one tool in the broader Adaptive Intelligence Platform — a suite built around cost control, security, quality, efficiency, and sovereignty.

Other tools: Whisper, Aegis, EmbedID, MarkFlow, CertiScope, TreeCraft, Test Generator, Chameleon LM, Praximous.

---

*Giblets Creations — James Gilbert*
*Built on Samsung S24 Ultra via Termux*
*April 2026*

