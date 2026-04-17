const fs = require('fs');
const FILE = 'scp-auto-updater.js';
let c = fs.readFileSync(FILE, 'utf8');

// Add getMonitorStatus method before generateSCP
const newMethod = `
  getMonitorStatus() {
    try {
      const logFile = require('path').join(__dirname, 'reasoning-bot/data/monitor_log.json');
      if (fs.existsSync(logFile)) {
        const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        return {
          checks:        log.checks || 0,
          trades:        log.trades ? log.trades.length : 0,
          open_positions: log.positions ? Object.keys(log.positions).length : 0,
          last_trade:    log.trades && log.trades.length ? log.trades[log.trades.length - 1] : null
        };
      }
    } catch (e) {}
    return { checks: 0, trades: 0, open_positions: 0, last_trade: null };
  }

`;

c = c.replace('  // Generate updated SCP JSON', newMethod + '  // Generate updated SCP JSON');

// Add monitor_status to platform_state in generateSCP
c = c.replace(
  "        btc_price: marketState?.marketState?.btcPrice || 71422.7\n      },",
  "        btc_price: marketState?.marketState?.btcPrice || 71422.7,\n        monitor: this.getMonitorStatus()\n      },"
);

fs.writeFileSync(FILE, c);
console.log('SCP watcher updated with monitor status');
