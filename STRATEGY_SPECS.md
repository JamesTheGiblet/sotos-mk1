# Kraken Intelligence — Final Strategy Specifications

## Overview

This document contains the complete specifications for all validated trading strategies discovered through exhaustive backtesting, walk-forward validation, and Monte Carlo simulation.

**Last Updated:** April 10, 2026
**Status:** Production Ready (Dry Run)
**Transaction Costs:** 0.3% round trip (included in all backtests)

---

## Strategy 1: Smart BTC

### Description
Combines two mean reversion signals: 4 consecutive red days OR RSI(21) below 20. Either signal triggers a long entry at the next candle open.

### Why It Works
- 4 red days captures exhaustion after sustained selling
- RSI(21)<20 captures deep oversold conditions
- The OR logic increases trade frequency without degrading quality

### Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Entry Signal** | 4 red days OR RSI(21) < 20 | Either condition triggers entry |
| **Entry Timing** | Next open | Avoids chasing the close |
| **Target** | 5% | Take profit at +5% |
| **Stop Loss** | 2.5% | Stop loss at -2.5% |
| **Max Hold** | 14 days | Timeout exit |
| **Asset** | BTC/USD | Only tested on BTC |

### Performance

| Metric | Value |
|--------|-------|
| Trades | 26 |
| Win Rate | 65.4% |
| Total Return | +130.8% |
| Expectancy | 3.59 |
| Final Capital ($100) | $230.75 |
| Avg Win | ~+8-10% |
| Avg Loss | ~-3-4% |

### Code Implementation

