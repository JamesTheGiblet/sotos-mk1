// ~/kraken-intelligence/reasoning-bot/strategy_selector.js

class StrategySelector {
  constructor() {
    this.strategies = {
      'smart_btc': {
        name: 'Smart BTC',
        entry: '4 red days OR RSI(30) < 30',
        target: 8,
        stop: 2,
        hold: 10,
        bestRegimes: ['MARKDOWN', 'DISTRIBUTION'],
        bestSentiment: ['EXTREME_FEAR', 'FEAR'],
        minVolatility: 1.5,
        maxVolatility: 5
      },
      'momentum': {
        name: 'Momentum',
        entry: 'EMA(12) cross above EMA(26) AND price > EMA(50)',
        target: 1.5,
        stop: 1,
        hold: 1,
        bestRegimes: ['TRENDING_UP'],
        bestSentiment: ['GREED', 'EXTREME_GREED'],
        minVolatility: 1,
        maxVolatility: 3
      },
      'grid': {
        name: 'Grid Trading',
        entry: 'Price within range, place limit orders',
        target: 0.5,
        stop: 0.3,
        hold: 0.5,
        bestRegimes: ['RANGING', 'QUIET'],
        bestSentiment: ['NEUTRAL'],
        minVolatility: 0.5,
        maxVolatility: 1.5
      },
      'breakout': {
        name: 'Breakout',
        entry: 'Bollinger squeeze + volume spike',
        target: 2,
        stop: 1.5,
        hold: 0.5,
        bestRegimes: ['VOLATILE'],
        bestSentiment: ['NEUTRAL', 'FEAR', 'GREED'],
        minVolatility: 2,
        maxVolatility: 8
      },
      'mean_reversion': {
        name: 'Mean Reversion',
        entry: '3 red days + RSI < 35',
        target: 4,
        stop: 2.5,
        hold: 7,
        bestRegimes: ['RANGING', 'MARKDOWN'],
        bestSentiment: ['FEAR', 'EXTREME_FEAR'],
        minVolatility: 1,
        maxVolatility: 4
      }
,
      'hyp_h_e_consecutive_red___rsi_mnzy4jj8': {
            "name": "H.E Consecutive Red + RSI",
            "entry": "3 consecutive red days AND RSI(14) < 35",
            "target": 13,
            "stop": 5,
            "hold": 12,
            "bestRegimes": [
                  "RANGING"
            ],
            "bestSentiment": [
                  "NEUTRAL",
                  "FEAR"
            ],
            "minVolatility": 1,
            "maxVolatility": 5,
            "validated": true,
            "win_rate": "62.5%",
            "backtest_return": "+41.5%",
            "validated_at": "2026-04-15T11:07:19.140Z"
      }
,
      'hyp_h_e_mean_reversion_bollinger_mnzy4xj9': {
            "name": "H.E Mean Reversion Bollinger",
            "entry": "Price below lower Bollinger Band AND RSI(14) < 35",
            "target": 13,
            "stop": 5,
            "hold": 12,
            "bestRegimes": [
                  "RANGING"
            ],
            "bestSentiment": [
                  "NEUTRAL",
                  "FEAR"
            ],
            "minVolatility": 1,
            "maxVolatility": 5,
            "validated": true,
            "win_rate": "56.3%",
            "backtest_return": "+45.2%",
            "validated_at": "2026-04-15T11:07:37.280Z"
      }
,
      'hyp_h_e_oversold_bounce_mnzz6puu': {
            "name": "H.E Oversold Bounce",
            "entry": "RSI(14) < 35 AND Price below lower Bollinger Band",
            "target": 13,
            "stop": 5,
            "hold": 12,
            "bestRegimes": [
                  "RANGING"
            ],
            "bestSentiment": [
                  "NEUTRAL",
                  "FEAR"
            ],
            "minVolatility": 1,
            "maxVolatility": 5,
            "validated": true,
            "win_rate": "56.3%",
            "backtest_return": "+41.9%",
            "validated_at": "2026-04-15T11:37:00.230Z"
      }
    };
  }

  select(marketState) {
    const scores = [];
    for (const [id, strategy] of Object.entries(this.strategies)) {
      let score = 0;
      if (strategy.bestRegimes && strategy.bestRegimes.includes(marketState.phase)) score += 30;
      else if (strategy.bestRegimes && strategy.bestRegimes.includes(marketState.regime)) score += 20;
      if (strategy.bestSentiment && strategy.bestSentiment.includes(marketState.sentiment)) score += 30;
      if (marketState.volatility >= (strategy.minVolatility||0) &&
          marketState.volatility <= (strategy.maxVolatility||99)) score += 20;
      else if (marketState.volatility < (strategy.minVolatility||0)) score -= 10;
      else if (marketState.volatility > (strategy.maxVolatility||99)) score -= 10;
      if (strategy.bestRegimes && strategy.bestRegimes.includes('TRENDING_UP') && marketState.trend > 0) score += 10;
      if (strategy.bestRegimes && strategy.bestRegimes.includes('MARKDOWN') && marketState.trend < 0) score += 10;
      scores.push({ id, strategy, score });
    }
    scores.sort((a, b) => b.score - a.score);
    const selected = scores[0];
    const optimizedParams = this.optimizeParameters(selected.strategy, marketState);
    return {
      selected: selected.id,
      name: selected.strategy.name,
      score: selected.score,
      params: optimizedParams,
      reasoning: this.generateReasoning(selected, marketState)
    };
  }

  optimizeParameters(strategy, marketState) {
    const params = { ...strategy };
    if (marketState.volatility > 3) {
      params.target = Math.min((params.target||8) * 1.2, 10);
      params.stop = Math.min((params.stop||2) * 1.2, 5);
    } else if (marketState.volatility < 1) {
      params.target = (params.target||8) * 0.8;
      params.stop = (params.stop||2) * 0.8;
    }
    if (marketState.phase === 'MARKUP' || marketState.phase === 'MARKDOWN') {
      params.hold = (params.hold||10) * 0.7;
    } else if (marketState.regime === 'RANGING') {
      params.hold = (params.hold||10) * 1.3;
    }
    return params;
  }

  generateReasoning(selected, marketState) {
    return `Selected ${selected.strategy.name} (score: ${selected.score}) because:
    - Market phase: ${marketState.phase}
    - Market regime: ${marketState.regime}
    - Sentiment: ${marketState.sentiment}
    - Volatility: ${marketState.volatility.toFixed(2)}%
    - Trend: ${marketState.trend.toFixed(1)}%`;
  }
}

module.exports = StrategySelector;