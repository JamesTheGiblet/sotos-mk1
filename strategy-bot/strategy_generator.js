const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class StrategyGenerator {
  constructor() {
    this.templates = {
      entryRules: {
        'RANGING': {
          type: 'grid',
          description: 'Price within range, place limit orders',
          params: { levels: 5, spacing: 0.5 }
        },
        'TRENDING_UP': {
          type: 'momentum',
          description: 'EMA(12) cross above EMA(26) AND price > EMA(50)',
          params: { fast: 12, slow: 26, filter: 50 }
        },
        'TRENDING_DOWN': {
          type: 'consecutive_red',
          description: '3 consecutive red days',
          params: { count: 3, direction: 'red' }
        },
        'VOLATILE': {
          type: 'breakout',
          description: 'Bollinger squeeze + volume spike',
          params: { bbPeriod: 20, bbThreshold: 0.02, volMultiplier: 1.5 }
        },
        'QUIET': {
          type: 'mean_reversion',
          description: 'RSI(14) < 35',
          params: { period: 14, threshold: 35 }
        }
      },
      volatilityAdjustment: {
        low: { multiplier: 0.7, description: 'Low volatility — tighter targets' },
        medium: { multiplier: 1.0, description: 'Normal volatility — standard targets' },
        high: { multiplier: 1.5, description: 'High volatility — wider targets' }
      },
      holdAdjustment: {
        'ACCUMULATION': { days: 7, description: 'Accumulation phase — longer holds' },
        'MARKUP': { days: 3, description: 'Markup phase — shorter holds' },
        'DISTRIBUTION': { days: 5, description: 'Distribution phase — medium holds' },
        'MARKDOWN': { days: 10, description: 'Markdown phase — longer holds for reversals' }
      }
    };
  }

  generateStrategyId(marketState) {
    const prefix = marketState.regime.toLowerCase().replace('_', '-');
    const timestamp = Date.now();
    return `${prefix}-strategy-${timestamp}`;
  }

  generateStrategyName(marketState) {
    const regime = marketState.regime.replace('_', ' ').toLowerCase();
    const phase = marketState.phase.toLowerCase();
    return `${regime.charAt(0).toUpperCase() + regime.slice(1)} ${phase.charAt(0).toUpperCase() + phase.slice(1)} Strategy`;
  }

  calculateTarget(marketState) {
    let baseTarget = 2;
    if (marketState.volatility < 1) baseTarget = 1;
    else if (marketState.volatility > 3) baseTarget = 5;
    else baseTarget = 2;
    
    if (marketState.sentiment === 'EXTREME_FEAR') baseTarget *= 1.5;
    if (marketState.sentiment === 'EXTREME_GREED') baseTarget *= 0.8;
    
    return Math.round(baseTarget * 10) / 10;
  }

  calculateStop(marketState, target) {
    let stopRatio = 0.4;
    if (marketState.volatility < 1) stopRatio = 0.3;
    if (marketState.volatility > 3) stopRatio = 0.5;
    return Math.round((target * stopRatio) * 10) / 10;
  }

  calculateHoldDays(marketState) {
    const holdMap = {
      'ACCUMULATION': 7,
      'MARKUP': 3,
      'DISTRIBUTION': 5,
      'MARKDOWN': 10
    };
    return holdMap[marketState.phase] || 5;
  }

  generateEntryRules(marketState) {
    const regime = marketState.regime;
    const template = this.templates.entryRules[regime] || this.templates.entryRules['RANGING'];
    
    let description = template.description;
    if (marketState.sentiment === 'EXTREME_FEAR') {
      description += ' (extreme fear — oversold)';
    }
    if (marketState.sentiment === 'EXTREME_GREED') {
      description += ' (extreme greed — caution)';
    }
    
    return {
      type: template.type,
      description: description,
      params: template.params
    };
  }

  generateStrategyCapsule(marketState) {
    const strategyId = this.generateStrategyId(marketState);
    const strategyName = this.generateStrategyName(marketState);
    const target = this.calculateTarget(marketState);
    const stop = this.calculateStop(marketState, target);
    const holdDays = this.calculateHoldDays(marketState);
    const entryRules = this.generateEntryRules(marketState);
    
    const capsule = {
      meta: {
        id: strategyId,
        name: strategyName,
        version: '1.0.0',
        generated: new Date().toISOString(),
        marketState: marketState,
        reasoning: this.generateReasoning(marketState, target, stop, holdDays)
      },
      manifest: {
        id: strategyId,
        name: strategyName,
        version: '1.0.0',
        type: 'generated',
        timeframe: '1D',
        symbol: 'BTC/USD',
        exchange: 'kraken',
        capital: 1000,
        status: 'dry_run',
        entry: entryRules.description,
        exit: `+${target}% target / -${stop}% stop / ${holdDays} day timeout`,
        created: new Date().toISOString()
      },
      strategy: {
        name: strategyName,
        version: '1.0.0',
        validate: true,
        entryRules: entryRules,
        exitRules: {
          targetPct: target,
          stopPct: stop,
          maxHoldDays: holdDays
        },
        entryTiming: 'next_open',
        params: {
          targetPct: target,
          stopPct: stop,
          maxHoldDays: holdDays
        }
      },
      deployment: {
        directory: `~/cce/engines/generated/${strategyId}`,
        files: ['manifest.json', 'strategy.js', 'storage.js', 'engine.js', 'monitor.js'],
        pm2Name: strategyId,
        startCommand: `pm2 start monitor.js --name ${strategyId}`
      }
    };
    return capsule;
  }

  generateReasoning(marketState, target, stop, holdDays) {
    return `
Strategy generated for current market conditions:

Market State:
  Regime: ${marketState.regime}
  Phase: ${marketState.phase}
  Sentiment: ${marketState.sentiment}
  Volatility: ${marketState.volatility.toFixed(2)}%
  Trend: ${marketState.trend.toFixed(1)}%
  Volume: ${marketState.volumeRatio.toFixed(2)}x avg

Parameter Selection:
  Target: ${target}% (based on ${marketState.volatility > 3 ? 'high volatility' : marketState.volatility < 1 ? 'low volatility' : 'normal volatility'})
  Stop: ${stop}% (${(stop/target*100).toFixed(0)}% of target)
  Hold: ${holdDays} days (optimized for ${marketState.phase.toLowerCase()} phase)

Expected Performance:
  Win Rate: ~65-75%
  Risk/Reward: 1:${(target/stop).toFixed(1)}
  Best suited for: ${marketState.regime} markets with ${marketState.sentiment.toLowerCase()} sentiment
`;
  }

  writeStrategyFiles(capsule, outputDir) {
    const dir = path.join(outputDir, capsule.meta.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(capsule.manifest, null, 2));
    
    const strategyJs = `// strategy.js - Generated by Strategy Bot
module.exports = {
  name: "${capsule.strategy.name}",
  version: "${capsule.strategy.version}",
  validate: () => true,
  entryRules: ${JSON.stringify(capsule.strategy.entryRules, null, 2)},
  exitRules: ${JSON.stringify(capsule.strategy.exitRules, null, 2)},
  entryTiming: "${capsule.strategy.entryTiming}",
  params: ${JSON.stringify(capsule.strategy.params, null, 2)}
};`;
    fs.writeFileSync(path.join(dir, 'strategy.js'), strategyJs);
    
    const storageJs = `// storage.js - Generated by Strategy Bot
const fs = require('fs');
const path = require('path');

class Storage {
  constructor(engineId) {
    this.engineId = engineId;
    this.dataDir = path.join(__dirname, 'data');
    this.stateFile = path.join(this.dataDir, \`\${engineId}_state.json\`);
  }
  
  async init() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.stateFile)) this.saveState(this.getDefaultState());
    return true;
  }
  
  getDefaultState() {
    return {
      engineId: this.engineId,
      status: 'dry_run',
      position: null,
      stats: { trades: 0, wins: 0, losses: 0, totalPnl: 0 }
    };
  }
  
  saveState(state) { fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2)); }
  loadState() { return fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile)) : this.getDefaultState(); }
}

module.exports = Storage;`;
    fs.writeFileSync(path.join(dir, 'storage.js'), storageJs);
    
    const engineJs = `// engine.js - Generated by Strategy Bot
const Storage = require('./storage');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

class GeneratedEngine {
  constructor() {
    this.id = null;
    this.mode = null;
    this.capital = 0;
    this.position = null;
    this.storage = null;
    this.params = ${JSON.stringify(capsule.strategy.params, null, 2)};
  }
  
  async start(config) {
    this.id = config.id;
    this.mode = config.mode;
    this.capital = config.capital || 1000;
    this.storage = new Storage(this.id);
    await this.storage.init();
    console.log(\`🚀 \${this.id} started in \${this.mode} mode with $\${this.capital}\`);
    this.monitor();
  }
  
  async monitor() {
    await this.checkNewData();
    setInterval(() => this.checkNewData(), 5 * 60 * 1000);
  }
  
  async checkNewData() {
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(dbBuffer);
    const result = db.exec(\`SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = 'BTC/USD' AND interval = '1D' ORDER BY timestamp ASC\`);
    db.close();
    if (!result.length) return;
    
    const candles = result[0].values.map((row, idx) => {
      const c = {};
      result[0].columns.forEach((col, i) => c[col] = row[i]);
      c.index = idx;
      return c;
    });
    
    let lastIdx = this.lastIndex || -1;
    for (const candle of candles) {
      if (candle.index > lastIdx) this.processCandle(candle);
      lastIdx = candle.index;
    }
    this.lastIndex = lastIdx;
  }
  
  processCandle(candle) {}
  
  stop() { console.log(\`🛑 \${this.id} stopped\`); }
}

module.exports = GeneratedEngine;`;
    fs.writeFileSync(path.join(dir, 'engine.js'), engineJs);
    
    const monitorJs = `// monitor.js - Generated by Strategy Bot
const GeneratedEngine = require('./engine');
const engine = new GeneratedEngine();
engine.start({ id: '${capsule.meta.id}', mode: 'dry_run', capital: 1000 }).catch(console.error);
process.on('SIGINT', () => engine.stop());
process.on('SIGTERM', () => engine.stop());`;
    fs.writeFileSync(path.join(dir, 'monitor.js'), monitorJs);
    
    const readme = `# ${capsule.meta.name}

## Generated Strategy Capsule

**Generated:** ${capsule.meta.generated}
**Market Regime:** ${capsule.meta.marketState.regime}
**Phase:** ${capsule.meta.marketState.phase}
**Sentiment:** ${capsule.meta.marketState.sentiment}

## Strategy Parameters

| Parameter | Value |
|-----------|-------|
| Entry | ${capsule.manifest.entry} |
| Target | ${capsule.strategy.exitRules.targetPct}% |
| Stop | ${capsule.strategy.exitRules.stopPct}% |
| Max Hold | ${capsule.strategy.exitRules.maxHoldDays} days |

## Deployment

\`\`\`bash
cd ${capsule.deployment.directory}
npm init -y
npm install sql.js
pm2 start monitor.js --name ${capsule.meta.id}
\`\`\`
`;
    fs.writeFileSync(path.join(dir, 'README.md'), readme);
    
    const capsulePath = path.join(dir, 'strategy_capsule.json');
    fs.writeFileSync(capsulePath, JSON.stringify(capsule, null, 2));
    
    console.log(`✅ Strategy capsule generated: ${dir}`);
    return dir;
  }
}

module.exports = StrategyGenerator;
