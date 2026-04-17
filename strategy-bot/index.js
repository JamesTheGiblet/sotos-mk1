const fs = require('fs');
const path = require('path');
const StrategyGenerator = require('./strategy_generator');

class StrategyBot {
  constructor() {
    this.generator = new StrategyGenerator();
    this.outputDir = path.join(process.env.HOME, 'cce', 'engines', 'generated');
    this.strategyHistory = [];
    this.lastMarketState = null;
  }

  async start() {
    console.log('\n' + '='.repeat(70));
    console.log('🧬 STRATEGY BOT — Autonomous Strategy Generator');
    console.log('='.repeat(70));
    console.log('Waiting for Reasoning Bot to provide market state...\n');
    this.monitorReasoningBot();
    setInterval(() => this.monitorReasoningBot(), 60 * 1000);
  }

  monitorReasoningBot() {
    const reasoningOutput = path.join(process.env.HOME, 'kraken-intelligence', 'reasoning-bot', 'active_strategy.json');
    if (!fs.existsSync(reasoningOutput)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(reasoningOutput, 'utf8'));
      const currentMarketState = data.marketState;
      if (this.shouldGenerateNewStrategy(currentMarketState)) {
        this.generateStrategy(currentMarketState);
        this.lastMarketState = currentMarketState;
      }
    } catch (err) {}
  }

  shouldGenerateNewStrategy(newState) {
    if (!this.lastMarketState) return true;
    if (this.lastMarketState.regime !== newState.regime) return true;
    if (this.lastMarketState.phase !== newState.phase) return true;
    return false;
  }

  generateStrategy(marketState) {
    console.log('\n' + '='.repeat(70));
    console.log('🧬 GENERATING NEW STRATEGY');
    console.log('='.repeat(70));
    console.log(`Market State: ${marketState.regime} | ${marketState.phase} | ${marketState.sentiment}`);
    
    const capsule = this.generator.generateStrategyCapsule(marketState);
    const outputPath = this.generator.writeStrategyFiles(capsule, this.outputDir);
    
    this.strategyHistory.push({
      timestamp: new Date().toISOString(),
      marketState: marketState,
      strategyId: capsule.meta.id,
      outputPath: outputPath
    });
    
    const historyPath = path.join(this.outputDir, 'strategy_history.json');
    fs.writeFileSync(historyPath, JSON.stringify(this.strategyHistory, null, 2));
    
    console.log(`\n✅ Strategy Capsule Generated:`);
    console.log(`   ID: ${capsule.meta.id}`);
    console.log(`   Target: ${capsule.strategy.exitRules.targetPct}%`);
    console.log(`   Stop: ${capsule.strategy.exitRules.stopPct}%`);
    console.log(`   Location: ${outputPath}`);
  }

  getHistory() {
    return { totalGenerated: this.strategyHistory.length, strategies: this.strategyHistory };
  }
}

module.exports = StrategyBot;

  // After generating strategy, add to dry run
  autoAddToDryRun(strategyName, outputPath) {
    try {
      const { execSync } = require('child_process');
      execSync(`cd ~/kraken-intelligence/dry-run-manager && node cli.js add ${strategyName} ${outputPath}`, { stdio: 'pipe' });
      console.log(`✅ Auto-added ${strategyName} to dry run`);
    } catch (err) {
      console.log(`⚠️ Could not auto-add to dry run: ${err.message}`);
    }
  }

  async validateAndPromote(strategyPath) {
    const { execSync } = require('child_process');
    try {
      console.log('🔬 Running validation pipeline...');
      const result = execSync(`cd ~/kraken-intelligence/validation-pipeline && node cli.js validate "${strategyPath}"`, { stdio: 'pipe' }).toString();
      console.log(result);
      
      if (result.includes('VALIDATION PASSED')) {
        console.log('✅ Strategy passed validation! Adding to dry run...');
        execSync(`cd ~/kraken-intelligence/dry-run-manager && node cli.js add ${path.basename(strategyPath)} ${strategyPath}`, { stdio: 'pipe' });
        return true;
      } else {
        console.log('❌ Strategy failed validation. Not proceeding to dry run.');
        return false;
      }
    } catch (err) {
      console.log('⚠️ Validation error:', err.message);
      return false;
    }
  }

  async generateSCP(strategy, validationResult) {
    const SCPGenerator = require('../scp/scp_generator');
    const generator = new SCPGenerator();
    const capsule = generator.generateSCP(strategy, validationResult);
    const outputPath = path.join(process.env.HOME, 'cce', 'engines', 'scp', capsule.manifest.id);
    generator.writeSCP(capsule, outputPath);
    return capsule;
  }
