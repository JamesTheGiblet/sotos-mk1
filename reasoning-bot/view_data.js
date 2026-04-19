const ReasoningBotStorage = require('./storage');

async function viewData() {
  const storage = new ReasoningBotStorage();
  await storage.init();
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 REASONING BOT — DATABASE VIEWER');
  console.log('═'.repeat(60));
  
  const stats = storage.getStats();
  console.log(`\n📈 STATISTICS:`);
  console.log(`   Market States: ${stats.totalStates}`);
  console.log(`   Strategy Selections: ${stats.totalSelections}`);
  console.log(`   Strategy Changes: ${stats.totalChanges}`);
  console.log(`   Active Alerts: ${stats.activeAlerts}`);
  
  // Get market states
  const states = storage.getMarketStateHistory(5);
  console.log(`\n📋 RECENT MARKET STATES (last 5):`);
  states.forEach(s => {
    console.log(`   ${s.timestamp.split('T')[0]} ${s.timestamp.split('T')[1].slice(0,8)} | ${s.regime} | ${s.phase} | ${s.sentiment}`);
  });
  
  // Get strategy selections
  const selections = storage.getStrategyHistory(5);
  console.log(`\n🎯 RECENT STRATEGY SELECTIONS (last 5):`);
  selections.forEach(s => {
    console.log(`   ${s.timestamp.split('T')[0]} | ${s.strategy_name} | Score:${s.score} | Target:${s.target_pct}%`);
  });
  
  // Get strategy changes
  const changes = storage.getStrategyChanges(5);
  console.log(`\n🔄 STRATEGY CHANGES (last 5):`);
  changes.forEach(c => {
    console.log(`   ${c.timestamp.split('T')[0]} | ${c.from_strategy || 'START'} → ${c.to_strategy}`);
  });
  
  // Get active alerts
  const alerts = storage.getActiveAlerts();
  console.log(`\n⚠️ ACTIVE ALERTS:`);
  if (alerts.length) {
    alerts.forEach(a => {
      console.log(`   [${a.severity}] ${a.type}: ${a.message.slice(0, 60)}`);
    });
  } else {
    console.log(`   No active alerts`);
  }
  
  storage.close();
}

viewData().catch(console.error);
