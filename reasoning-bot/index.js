const MarketAnalyser = require('./market_analyser');
const StrategySelector = require('./strategy_selector');
const ReasoningBotStorage = require('./storage');
const fs = require('fs');
const path = require('path');

class ReasoningBot {
  constructor() {
    this.analyser = new MarketAnalyser();
    this.selector = new StrategySelector();
    this.storage = null;
    this.currentStrategy = null;
    this.strategyHistory = [];
    this.lastReanalysis = null;
    this.reanalysisInterval = 60 * 60 * 1000;
  }

  async init() {
    this.storage = new ReasoningBotStorage();
    await this.storage.init();
    return this;
  }

  async start() {
    await this.init();
    
    console.log('\n' + '='.repeat(70));
    console.log('🧠 REASONING BOT — Market-Adaptive Strategy Engine');
    console.log('='.repeat(70));
    
    const stats = this.storage.getStats();
    console.log(`📊 Database stats: ${stats.totalStates} states, ${stats.totalSelections} selections\n`);
    
    await this.run();
    setInterval(() => this.run(), this.reanalysisInterval);
  }

  async runOnce() {
    await this.init();
    await this.run();
    setTimeout(() => process.exit(0), 2000);
  }

  async run() {
    try {
      const marketState = await this.analyser.analyse();
      marketState.timestamp = new Date().toISOString();
      
      const marketStateId = this.storage.saveMarketState(marketState);
      
      const selection = this.selector.select(marketState);
      selection.timestamp = marketState.timestamp;
      
      this.storage.saveStrategySelection(selection, marketStateId);
      
      const strategyChanged = this.currentStrategy !== selection.selected;
      
      if (strategyChanged && this.currentStrategy) {
        const change = {
          timestamp: marketState.timestamp,
          from: this.currentStrategy,
          to: selection.selected,
          reason: selection.reasoning
        };
        this.storage.saveStrategyChange(change, marketStateId);
        this.strategyHistory.push(change);
        
        console.log('\n' + '='.repeat(70));
        console.log('🔄 STRATEGY CHANGE DETECTED');
        console.log('='.repeat(70));
        console.log(`   Previous: ${this.currentStrategy}`);
        console.log(`   New: ${selection.name}`);
        console.log(`   Score: ${selection.score}`);
      } else if (!this.currentStrategy) {
        console.log('\n' + '='.repeat(70));
        console.log('🎯 INITIAL STRATEGY SELECTED');
        console.log('='.repeat(70));
        console.log(`   Strategy: ${selection.name}`);
        console.log(`   Score: ${selection.score}`);
      }
      
      this.currentStrategy = selection.selected;
      this.displayStatus(marketState, selection);
      this.executeStrategy(selection);
      this.lastReanalysis = new Date();
      
      this.checkAlerts(marketState, selection);
      
      const stats = this.storage.getStats();
      console.log(`\n📊 Total saved: ${stats.totalStates} market states, ${stats.totalSelections} selections`);
      
    } catch (error) {
      console.error('❌ Reasoning bot error:', error.message);
    }
  }

  displayStatus(marketState, selection) {
    console.log('\n' + '─'.repeat(70));
    console.log('📊 CURRENT MARKET STATE');
    console.log('─'.repeat(70));
    console.log(`   Regime:     ${marketState.regime}`);
    console.log(`   Phase:      ${marketState.phase}`);
    console.log(`   Sentiment:  ${marketState.sentiment}`);
    console.log(`   Volatility: ${marketState.volatility.toFixed(2)}%`);
    console.log(`   Trend:      ${marketState.trend.toFixed(1)}%`);
    console.log(`   Volume:     ${marketState.volumeRatio.toFixed(2)}x avg`);
    if (marketState.btcPrice) {
      console.log(`   BTC Price:  $${marketState.btcPrice.toFixed(2)}`);
    }
    
    console.log('\n' + '─'.repeat(70));
    console.log('🎯 RECOMMENDED STRATEGY');
    console.log('─'.repeat(70));
    console.log(`   Name:       ${selection.name}`);
    console.log(`   Target:     ${selection.params.target}%`);
    console.log(`   Stop:       ${selection.params.stop}%`);
    console.log(`   Hold:       ${selection.params.hold} days`);
    console.log(`   Confidence: ${selection.score}%`);
  }

  executeStrategy(selection) {
    const configPath = path.join(__dirname, 'active_strategy.json');
    fs.writeFileSync(configPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      strategy: selection.selected,
      name: selection.name,
      marketState: this.analyser.getState()
    }, null, 2));
    console.log('\n💾 Strategy configuration saved to active_strategy.json');
  }

  checkAlerts(marketState, selection) {
    if (marketState.volatility > 5) {
      this.storage.saveAlert('WARN', 'high_volatility', `Volatility spiked to ${marketState.volatility.toFixed(2)}%`);
    }
    if (marketState.volumeRatio > 2.5) {
      this.storage.saveAlert('INFO', 'volume_spike', `Volume spike: ${marketState.volumeRatio.toFixed(2)}x average`);
    }
    if (marketState.sentiment === 'EXTREME_FEAR') {
      this.storage.saveAlert('WARN', 'extreme_fear', 'Extreme fear detected');
    }
    if (marketState.sentiment === 'EXTREME_GREED') {
      this.storage.saveAlert('WARN', 'extreme_greed', 'Extreme greed detected');
    }
    if (selection.score < 50) {
      this.storage.saveAlert('INFO', 'low_confidence', `Low confidence strategy (${selection.score}%): ${selection.name}`);
    }
  }

  getStatus() {
    return {
      currentStrategy: this.currentStrategy,
      lastReanalysis: this.lastReanalysis,
      strategyHistory: this.strategyHistory.slice(-10),
      marketState: this.analyser.getState(),
      databaseStats: this.storage ? this.storage.getStats() : null
    };
  }
}

module.exports = ReasoningBot;
