const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('strategy_selector.js', 'utf8');

// Check if select method exists
if (content.includes('select(marketState)')) {
  console.log('✅ select method present — file looks OK');
  process.exit(0);
}

console.log('❌ select method missing — restoring...');

// Find where this.strategies closes and insert select method
const insertPoint = content.lastIndexOf('};');
if (insertPoint === -1) {
  console.log('❌ Could not find insertion point');
  process.exit(1);
}

const selectMethod = `

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
    return \`Selected \${selected.strategy.name} (score: \${selected.score}) because:
    - Market phase: \${marketState.phase}
    - Market regime: \${marketState.regime}
    - Sentiment: \${marketState.sentiment}
    - Volatility: \${marketState.volatility.toFixed(2)}%
    - Trend: \${marketState.trend.toFixed(1)}%\`;
  }
}

module.exports = StrategySelector;`;

// Remove any existing broken tail and replace
const beforeClose = content.slice(0, insertPoint + 2);
// Strip any broken methods after the strategies closing
const cleanContent = beforeClose.replace(/\s*optimizeParameters[\s\S]*$/, '') + selectMethod;

fs.writeFileSync('strategy_selector.js', cleanContent);
console.log('✅ Restored select, optimizeParameters, generateReasoning methods');
