# Kraken Intelligence — Quick Reference

## The Five Pillars

| Pillar | How KI Delivers |
|--------|-----------------|
| **Cost Control** | Runs on Termux (phone), free API, no cloud |
| **Security** | 3 locks, API keys in .env, 30-day dry runs |
| **Quality** | Backtest + forward test, auto-optimization |
| **Efficiency** | 24/7 autonomous, market-adaptive switching |
| **Freedom** | MIT License, SCP portable strategies |

## One-Line Summary

**Autonomous trading system that validates itself on unseen data before ever trading live.**

## Core Numbers

| Metric | Value |
|--------|-------|
| Minimum win rate | 55% |
| Minimum trades | 8 |
| Dry run days | 30 |
| Auto-optimization attempts | 10 |
| Data split | 80/20 (backtest/forward) |

## The Three Locks

```

Lock 1: 30 days dry run ─────► Cannot bypass
Lock 2: Validation (≥55% WR) ► Auto-tested
Lock 3: API key in .env ─────► User controlled

```

## Quick Commands

```bash
# Status
./platform-status.sh

# Market state
cat reasoning-bot/active_strategy.json | jq '.marketState'

# SCP
cd scp && node cli.js generate consecutive_red 2 1 5

# PM2
pm2 list
pm2 logs [name]
```

Philosophy

"I built these tools because I was tired of the same problems breaking my workflow. Then I realized I was building an entire platform."

