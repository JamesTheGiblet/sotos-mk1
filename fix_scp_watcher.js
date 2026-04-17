const fs = require('fs');
const FILE = 'scp-auto-updater.js';
let c = fs.readFileSync(FILE, 'utf8');

const oldGenerate = `  // Generate updated SCP JSON
  generateSCP() {`;

const newGenerate = `  // Generate updated SCP JSON
  generateSCP() {
    // Load existing SCP to preserve rich fields
    let existing = {};
    try {
      if (fs.existsSync(this.scpFile)) {
        existing = JSON.parse(fs.readFileSync(this.scpFile, 'utf8'));
      }
    } catch (e) {}`;

// Replace the scpData construction to merge with existing
const oldScpData = `    const scpData = {
      protocol: {
        name: "Semantic Capsule Protocol",
        version: "1.0.0"
      },
      manifest: {
        id: \`kraken-intelligence-platform-\${new Date().toISOString().split('T')[0]}\`,
        name: "Kraken Intelligence Platform",
        version: "1.3.0",
        created: new Date().toISOString(),
        type: "platform_state",
        status: "active_dry_run",
        last_updated: new Date().toISOString()
      },
      platform_state: {
        pm2_processes: pm2Processes.map(p => ({ name: p.name, status: p.status })),
        candles_collected: candleCount,
        scp_capsules: scpCapsuleCount,
        active_strategy: marketState?.strategy || "H.E Consecutive Red + RSI",
        market_regime: marketState?.marketState?.regime || "RANGING",
        market_sentiment: marketState?.marketState?.sentiment || "NEUTRAL",
        market_phase: marketState?.marketState?.phase || "ACCUMULATION",
        btc_price: marketState?.marketState?.btcPrice || 71422.7,
        monitor: this.getMonitorStatus()
      },
      archive_summary: archiveSummary,
      lifecycle: {
        status: "active_dry_run",
        last_updated: new Date().toISOString(),
        version_notes: "Auto-updated by SCP watcher"
      },
      sovereignty: {
        license: "MIT",
        runs_on: "Samsung S24 Ultra via Termux",
        no_cloud: true,
        data_stays_local: true
      },
      cognitive_layer: {
        intent: "A self-improving trading platform that generates, validates and monitors strategies using real market data.",
        philosophy: "Build it honestly. Test it properly. Let real data decide.",
        mantra: "I wanted it. So I forged it. Now forge yours."
      }
    };`;

const newScpData = `    // Merge: preserve existing rich fields, update only dynamic ones
    const scpData = Object.assign({}, existing, {
      protocol: existing.protocol || { name: "Semantic Capsule Protocol", version: "1.0.0" },
      manifest: Object.assign({}, existing.manifest || {}, {
        last_updated: new Date().toISOString(),
        status: "active_dry_run"
      }),
      platform_state: Object.assign({}, existing.platform_state || {}, {
        pm2_processes: pm2Processes.map(p => ({ name: p.name, status: p.status })),
        candles_collected: candleCount,
        scp_capsules: scpCapsuleCount,
        active_strategy: marketState?.strategy || (existing.platform_state && existing.platform_state.active_strategy) || "unknown",
        market_regime: marketState?.marketState?.regime || "RANGING",
        market_sentiment: marketState?.marketState?.sentiment || "NEUTRAL",
        market_phase: marketState?.marketState?.phase || "ACCUMULATION",
        btc_price: marketState?.marketState?.btcPrice || (existing.platform_state && existing.platform_state.btc_price) || 0,
        monitor: this.getMonitorStatus()
      }),
      lifecycle: Object.assign({}, existing.lifecycle || {}, {
        status: "active_dry_run",
        last_updated: new Date().toISOString(),
        version_notes: existing.lifecycle && existing.lifecycle.version_notes ? existing.lifecycle.version_notes : "Auto-updated by SCP watcher"
      })
    });`;

if (c.includes(oldGenerate) && c.includes(oldScpData)) {
  c = c.replace(oldGenerate, newGenerate);
  c = c.replace(oldScpData, newScpData);
  fs.writeFileSync(FILE, c);
  console.log('SCP watcher updated — now preserves rich fields');
} else {
  console.log('Could not find target blocks — check manually');
  console.log('Has generateSCP:', c.includes('generateSCP'));
  console.log('Has scpData:', c.includes('const scpData'));
}
