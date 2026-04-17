const fs = require('fs');
const d = JSON.parse(fs.readFileSync('scp-capsule-share.json', 'utf8'));

d.engines = [
  { name: 'smart-btc', description: 'Smart BTC Strategy', pairs: ['BTC/USD'], entry: '4 consecutive red days OR RSI(21) < 20', exit: '+5% target / -2.5% stop / 14 day timeout', capital: 100, status: 'dry_run', validation: { train: '80% WR +40%', test: '43% WR +12%', validate: '71% WR +48%', monte_carlo: '100% profitable' } },
  { name: 'four-red-days', description: '4 Red Days', pairs: ['BTC/USDC'], entry: '4 consecutive red days', exit: '+1% target / -0.75% stop / 5 day timeout', capital: 100, status: 'dry_run', validation: { backtest: '79% WR +74% return' } },
  { name: 'three-asset-portfolio', description: 'Three Asset Portfolio', pairs: ['LINK/USD', 'BTC/USD', 'LTC/USD'], allocations: { 'LINK/USD': 0.40, 'BTC/USD': 0.40, 'LTC/USD': 0.20 }, entry: '4 consecutive red days', exit: '+1% target / -0.75% stop / 5 day timeout', capital: 250, status: 'dry_run', validation: { forward_wr: '84%', forward_return: '+23.4%', period: '20% unseen data' } },
  { name: 'multi-asset-meta', description: 'Multi-Asset Meta Strategy', pairs: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD'], capital: 250, status: 'dry_run' },
  { name: 'grid-trading-1h', description: 'Grid Trading 1H Validated', pairs: ['BTC/USD'], entry: 'Price below MA(20) by 0.5% in low volatility', exit: 'Price recovers above MA(20)', capital: 500, status: 'dry_run', validation: { wr: '77.8%', return: '+7.6%', timeframe: '1H' } },
  { name: 'ranging-strategy-generated', description: 'Ranging Accumulation Strategy', pairs: ['BTC/USD'], capital: 1000, status: 'dry_run', validation: { forward_wr: '85.7%', forward_return: '+23.6%' } },
  { name: 'forge-monitor', description: 'Forge Intelligence Monitor', pairs: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD'], status: 'monitoring' }
];

d.standalone_engines = [
  { name: 'pharaoh', description: 'XRP Sentiment Engine — standalone, not swappable', pairs: ['XRP/USD'], capital: 250, status: 'running_dry', current_state: 'WATCHING', note: 'Independent sentiment-based engine. Not part of the Forge strategy selector pool.' },
  { name: 'cce-crypto', description: 'Cascade Compounding Engine — the Anchor. Always running, always watching.', pairs: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD'], status: 'cascade_rotation', role: 'anchor', note: 'Exploits temporal capital flow patterns. Not part of the Forge strategy selector pool.' }
];

d.validated_strategies = [
  { name: 'H.E Consecutive Red + RSI', win_rate: '62.5%', backtest_return: '+41.5%', entry_rules: ['3 consecutive red days', 'RSI(14) < 35'], exit_rules: ['RSI(14) > 55'], risk: { stop: '-5%', target: '+13%', hold: 12 } },
  { name: 'H.E Mean Reversion Bollinger', win_rate: '56.3%', backtest_return: '+45.2%', entry_rules: ['Price below lower Bollinger Band', 'RSI(14) < 35'], exit_rules: ['RSI(14) > 50', 'Price above MA(20)'], risk: { stop: '-5%', target: '+13%', hold: 12 } },
  { name: 'H.E Oversold Bounce', win_rate: '56.3%', backtest_return: '+41.9%', entry_rules: ['RSI(14) < 35', 'Price below lower Bollinger Band'], exit_rules: ['RSI(14) > 55', 'Price above MA(50)'], risk: { stop: '-5%', target: '+13%', hold: 12 } },
  { name: 'Grid Trading (1H Validated)', win_rate: '77.8%', backtest_return: '+7.6%', entry_rules: ['Market Volatility < 0.5%', 'Price below MA(20) by 0.5% or more'], exit_rules: ['Price recovers above MA(20)'], risk: { stop: '-0.2%', target: '+0.3%', hold_hours: 12 }, note: '1H candles only.' }
];

d.honest_status = {
  what_works: 'Forge loop functional. Correct strategy selected. 7 pairs collecting daily. Multi-pair monitor running. Dashboard with GOLEM chat live. PM2 cwd bug fixed.',
  what_is_pending: 'No live entry signal caught yet after 383 checks. Backtest results from historical data only. Forward performance not yet proven.',
  next_real_test: 'Monitor catching a genuine entry signal in live market conditions.'
};

d.pending_integrations = [
  { name: 'auth-system', description: 'Production-ready JWT authentication backend', repo: 'https://github.com/JamesTheGiblet/auth-system', stack: ['Node.js', 'Express.js', 'MongoDB', 'Jest'], when_needed: 'When a web dashboard or external API is built', dependency_note: 'Requires MongoDB', status: 'pending' },
  { name: 'emergent-stock-monitor', description: 'Physics-based market visualisation — Adaptive Market Particle System built on Forge Theory', repo: 'https://github.com/JamesTheGiblet/emergent-stock-monitor', forge_theory_connection: 'Visual layer for regime and energy states', adaptation_needed: 'Needs adapting to Kraken data', when_needed: 'When dashboard visualisation layer is built', status: 'pending' },
  { name: 'quantalgo', description: 'Evolutionary emergence engine — rebuilt as forge-evolution.js', status: 'integrated' },
  { name: 'justitia-uk', description: 'UK Legal Intelligence Platform — separate business, RAG architecture learnings applicable to hypothesis generation', status: 'separate_project' }
];

d.manifest.version = '1.4.0';
d.lifecycle.version_notes = 'v1.4 — Rich fields restored. SCP watcher now preserves context.';

fs.writeFileSync('scp-capsule-share.json', JSON.stringify(d, null, 2));
console.log('SCP restored with all rich fields');
