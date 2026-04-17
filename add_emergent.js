const fs = require('fs');
const d = JSON.parse(fs.readFileSync('scp-capsule-share.json', 'utf8'));

if (!d.pending_integrations) d.pending_integrations = [];

d.pending_integrations.push({
  name: 'emergent-stock-monitor',
  description: 'Physics-based market visualisation — Adaptive Market Particle System built on Forge Theory',
  repo: 'https://github.com/JamesTheGiblet/emergent-stock-monitor',
  stack: ['HTML5', 'Vanilla JS', 'CSS3', 'Canvas API'],
  features: [
    'Particle physics simulation per asset',
    'Resonance detection across assets',
    'System energy states (Kinetic/Potential/Balanced)',
    'Momentum clusters and sector movement alerts',
    'Buy/sell signals with confidence scores',
    'JSON/CSV export'
  ],
  forge_theory_connection: 'Visual layer for regime and energy states already calculated by market_analyser.js',
  adaptation_needed: 'Currently uses Yahoo Finance — needs adapting to pull from local intelligence.db and Kraken data',
  when_needed: 'When dashboard is built — this becomes the visualisation layer',
  status: 'pending'
});

d.manifest.version = '1.2.4';
d.lifecycle.last_updated = new Date().toISOString();
fs.writeFileSync('scp-capsule-share.json', JSON.stringify(d, null, 2));
console.log('Emergent Stock Monitor added as pending integration');
