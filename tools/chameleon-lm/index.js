#!/usr/bin/env node
/**
 * Chameleon LM — Domain Expertise Adapter
 * Part of the Adaptive Intelligence Platform
 * License: MIT
 * 
 * Adapts responses based on market regime and trading context
 */

class ChameleonLM {
  constructor() {
    this.personas = {
      conservative: {
        name: 'Conservative Trader',
        riskTolerance: 0.2,
        maxPositionSize: 0.05,
        preferredStrategies: ['grid', 'mean_reversion']
      },
      aggressive: {
        name: 'Aggressive Trader',
        riskTolerance: 0.7,
        maxPositionSize: 0.2,
        preferredStrategies: ['momentum', 'breakout']
      },
      balanced: {
        name: 'Balanced Trader',
        riskTolerance: 0.5,
        maxPositionSize: 0.1,
        preferredStrategies: ['consecutive_red', 'smart_btc']
      }
    };
  }

  adaptToMarket(marketState) {
    const regime = marketState?.regime || 'RANGING';
    const sentiment = marketState?.sentiment || 'NEUTRAL';
    
    let persona = 'balanced';
    if (sentiment === 'EXTREME_FEAR' || regime === 'TRENDING_DOWN') {
      persona = 'conservative';
    } else if (sentiment === 'EXTREME_GREED' || regime === 'TRENDING_UP') {
      persona = 'aggressive';
    }
    
    return this.personas[persona];
  }

  generateAdvice(marketState, strategy) {
    const persona = this.adaptToMarket(marketState);
    
    let advice = `Based on ${persona.name} strategy:\n`;
    advice += `- Risk tolerance: ${persona.riskTolerance * 100}%\n`;
    advice += `- Max position size: ${persona.maxPositionSize * 100}%\n`;
    
    if (strategy) {
      advice += `- Recommended strategy: ${strategy.type || 'unknown'}\n`;
      advice += `- Target: ${strategy.targetPct || 'N/A'}%\n`;
      advice += `- Stop loss: ${strategy.stopPct || 'N/A'}%\n`;
    }
    
    return advice;
  }
}

module.exports = ChameleonLM;
