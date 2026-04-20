#!/usr/bin/env node
/**
 * forge-dashboard.js
 * S.O.T.O.S MK1 — Corporate pitch dashboard.
 * GOLEM v3 — regime-aware, state-wired, live data.
 */

'use strict';

const express      = require('express');
const http         = require('http');
const WebSocket    = require('ws');
const fs           = require('fs');
const path         = require('path');
const https        = require('https');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

// Manual brute-force fallback in case PM2 refuses to clear its env cache
try {
  let envPath = path.join(__dirname, '.env');
  // Fallback to .env.txt if Windows secretly added an extension
  if (!fs.existsSync(envPath) && fs.existsSync(path.join(__dirname, '.env.txt'))) {
    envPath = path.join(__dirname, '.env.txt');
  }
  if (fs.existsSync(envPath)) {
    // Strip null bytes (UTF-16 encoding) and aggressively extract the key
    const envContent = fs.readFileSync(envPath, 'utf8').replace(/\0/g, '');
    const match = envContent.match(/GEMINI_API_KEY=([a-zA-Z0-9_\-]+)/);
    if (match) {
      process.env.GEMINI_API_KEY = match[1];
    }
  }
} catch(e) {}

const PORT = parseInt(process.env.DASHBOARD_PORT) || 3001;
const HOME = process.env.HOME || process.env.USERPROFILE || '';

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, perMessageDeflate: true });

app.use(express.json());

function readJSON(p, fb) {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}
  return fb || null;
}

function getPM2() {
  try {
    return JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' })).map(p => ({
      name: p.name, status: p.pm2_env.status,
      memory: Math.round((p.monit?.memory || 0) / 1024 / 1024)
    }));
  } catch(e) { return []; }
}

function getState() {
  const base  = __dirname;
  const strat = readJSON(path.join(base, 'reasoning-bot/active_strategy.json'));
  const mon   = readJSON(path.join(base, 'reasoning-bot/data/monitor_log.json'));
  let consecutiveLosses = 0;
  if (mon && mon.trades) {
    for (let i = mon.trades.length - 1; i >= 0; i--) {
      if (!mon.trades[i].win) consecutiveLosses++;
      else break;
    }
  }
  const fails = readJSON(path.join(base, 'reasoning-bot/data/validation_failures.json'), []);
  const ph    = readJSON(path.join(HOME, 'golem/test-engines/pharaoh/data/pharaoh-state.json'));
  const arc   = readJSON(path.join(base, 'reasoning-bot/data/strategy_archive.json'), []);
  const pxAlerts = readJSON(path.join(base, 'reasoning-bot/data/praximous_alerts.json'), []);
  let strategies = [];
  try {
    const sel = fs.readFileSync(path.join(base, 'reasoning-bot/strategy_selector.js'), 'utf8');
    strategies = (sel.match(/'([^']+)':\s*\{[^}]*"name":\s*"([^"]+)"[^}]*\}/g) || []).map(block => {
      const idM = block.match(/'([^']+)':/), nmM = block.match(/"name":\s*"([^"]+)"/);
      const wrM = block.match(/"win_rate":\s*"([^"]+)"/), retM = block.match(/"backtest_return":\s*"([^"]+)"/);
      return { id: idM&&idM[1]||'', name: nmM&&nmM[1]||'Unknown',
               wr: wrM&&wrM[1]||null, ret: retM&&retM[1]||null,
               active: !!(strat && strat.strategy === (idM&&idM[1]||'')) };
    });
  } catch(e) {}
  return {
    timestamp: new Date().toISOString(),
    market:    strat ? strat.marketState : null,
    strategy:  strat ? { id: strat.strategy, name: strat.name } : null,
    monitor:   mon ? { checks: mon.checks, trades: mon.trades ? mon.trades.length : 0,
                       positions: Object.keys(mon.positions||{}).length, consecutiveLosses } : null,
    pharaoh: ph, failures: fails.slice(0,3), total_failures: fails.length, strategies,
    archive_count: arc.length, pm2: getPM2(), praximous_alerts: pxAlerts
  };
}

async function getPrices() {
  return new Promise(resolve => {
    https.get('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD,XRPUSD,LINKUSD,LTCUSD,ETHXBT',
      { headers: { 'User-Agent': 'Forge/1.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const map = { XXBTZUSD:'BTC', XETHZUSD:'ETH', SOLUSD:'SOL',
                        XXRPZUSD:'XRP', LINKUSD:'LINK', XLTCZUSD:'LTC', XETHXXBT:'ETHBTC', ETHXBT:'ETHBTC' };
          const out = {};
          for (const [k, v] of Object.entries(JSON.parse(d).result || {})) {
            const sym = map[k], price = parseFloat(v.c[0]), avg = parseFloat(v.p[1]);
            if (sym) out[sym] = { price, change: avg > 0 ? Math.round((price-avg)/avg*10000)/100 : 0 };
          }
          resolve(out);
        } catch(e) { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

let chatHistory = [];

async function askGemini(message, context) {
  if (!process.env.GEMINI_API_KEY) return '⚠️ API error: GEMINI_API_KEY is missing from your .env file.';
  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    let prompt = context + '\n\n';
    if (chatHistory.length > 0) {
      prompt += '--- Conversation History ---\n';
      chatHistory.forEach(m => prompt += `${m.role}: ${m.text}\n`);
      prompt += '----------------------------\n\n';
    }
    prompt += 'User: ' + message;

    const r  = await ai.models.generateContent({ 
      model: 'gemini-2.5-flash', 
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 150
      }
    });
    const response = r.text || 'No response';
    
    chatHistory.push({ role: 'User', text: message });
    chatHistory.push({ role: 'GOLEM', text: response });
    
    // Keep the last 5 exchanges (10 messages total)
    if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
    
    return response;
  } catch(e) { return 'API error: ' + e.message; }
}

app.get('/api/state', async (req, res) => {
  const state = getState(), prices = await getPrices();
  res.json({ ...state, prices });
});

app.post('/api/action', (req, res) => res.json({ response: null, action: null }));

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.json({ error: 'No message' });
  
  let swarmStatus = 'Swarm inactive.';
  try {
    const out = execSync('node tools/praximous/cli.js run', { cwd: __dirname, encoding: 'utf8' });
    const lines = out.split('\n').filter(l => l.includes('✅') || l.includes('🚨') || l.includes('⚠️') || l.includes('🛑')).map(l => l.trim());
    swarmStatus = lines.join(' | ');
  } catch(e) {}

  const s = getState();
  const c = 'You are GOLEM, the AI intelligence core of S.O.T.O.S — a sovereign trading intelligence platform.\n'
    + 'Answer clearly and concisely. Plain English, no fluff.\n\nSystem state:\n'
    + '- Regime: '     + ((s.market&&s.market.regime)       || 'UNKNOWN') + '\n'
    + '- BTC: $'       + ((s.market&&s.market.btcPrice)      || '?')       + '\n'
    + '- Sentiment: '  + ((s.market&&s.market.sentiment)     || 'UNKNOWN') + '\n'
    + '- Volume: '     + ((s.market&&s.market.volumeRatio)   || '?')       + 'x avg\n'
    + '- Strategy: '   + ((s.strategy&&s.strategy.name)      || 'None')    + '\n'
    + '- Checks: '     + ((s.monitor&&s.monitor.checks)       || 0)        + '\n'
    + '- Trades: '     + ((s.monitor&&s.monitor.trades)       || 0)        + '\n'
    + '- Failures: '   + (s.total_failures || 0) + '\n'
    + '- Pharaoh: '    + ((s.pharaoh&&s.pharaoh.currentState) || 'UNKNOWN') + ' $' + ((s.pharaoh&&s.pharaoh.xrpPrice)||'?') + '\n'
    + '- F&G: '        + ((s.pharaoh&&s.pharaoh.fearGreed)    || '?')      + '/100\n'
    + '- Pool: '       + ((s.strategies&&s.strategies.length)  || 0)        + '\n'
    + '- PM2 online: ' + ((s.pm2&&s.pm2.filter(p=>p.status==='online').length) || 0) + '\n'
    + '- Praximous Swarm: ' + swarmStatus;
  res.json({ response: await askGemini(message, c) });
});

async function broadcast() {
  if (wss.clients.size === 0) return;
  const state = getState(), prices = await getPrices();
  const data  = JSON.stringify({ type: 'update', ...state, prices });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

wss.on('connection', async ws => {
  const state = getState(), prices = await getPrices();
  ws.send(JSON.stringify({ type: 'init', ...state, prices }));
});

setInterval(broadcast, 30000);

app.get('/', (req, res) => res.send(getFrontend()));

function getFrontend() { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>S.O.T.O.S</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#09090b;--bg2:#111113;--bg3:#18181b;--bg4:#1f2024;--border:#27272a;--border2:#3f3f46;--accent:#2563eb;--accent2:#3b82f6;--accent3:#60a5fa;--cyan:#06b6d4;--green:#10b981;--gold:#f59e0b;--red:#ef4444;--text:#fafafa;--text2:#a1a1aa;--text3:#71717a;}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;overflow:hidden}
#app{position:fixed;inset:0;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:11px 18px;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0}
.brand{display:flex;align-items:baseline;gap:9px}
.brand-name{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:500;letter-spacing:3px;color:var(--text)}
.brand-sep{width:1px;height:12px;background:var(--border2)}
.brand-sub{font-size:9px;color:var(--text3);letter-spacing:1.5px;font-family:'JetBrains Mono',monospace}
.topbar-right{display:flex;align-items:center;gap:10px}
.live-pill{display:flex;align-items:center;gap:5px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.18);border-radius:20px;padding:3px 9px}
.live-dot{width:5px;height:5px;border-radius:50%;background:var(--green);box-shadow:0 0 5px var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
.live-txt{font-size:9px;color:var(--green);font-weight:600;letter-spacing:1.5px;font-family:'JetBrains Mono',monospace}
.data-btn{background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:1.5px;padding:5px 12px;cursor:pointer}
.data-btn:active{background:var(--accent);color:white;border-color:var(--accent)}
.stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;padding:6px 20px 4px;overflow:hidden}
#golem-canvas{width:230px;height:230px;flex-shrink:0}
.golem-label{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:5px;color:var(--text3);margin-top:10px}
.golem-state{font-size:12px;margin-top:5px;min-height:16px;text-align:center;padding:0 24px;transition:color 0.5s;letter-spacing:0.3px}
.regime-badge{margin-top:5px;font-size:8px;letter-spacing:2.5px;padding:2px 9px;border-radius:8px;border:1px solid;transition:all 0.5s;font-family:'JetBrains Mono',monospace}

/* Desktop & Mobile Layout Unification */
.main-content{display:flex;flex:1;overflow:hidden;position:relative;flex-direction:column}
.left-pane{display:flex;flex-direction:column;flex:1;overflow:hidden;min-width:0}
#panel{position:absolute;inset:0;z-index:100;background:var(--bg);transform:translateY(100%);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);display:flex;flex-direction:column}
#panel.open{transform:translateY(0)}
@media(min-width: 950px){
  .main-content{flex-direction:row;} .left-pane{flex:0 0 360px;border-right:1px solid var(--border);}
  #panel{position:static;transform:none;flex:1;z-index:1;} .panel-bar,.data-btn{display:none;}
  .panel-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-content:start;grid-auto-rows:max-content;} .sgrid,.full-width{grid-column:1/-1;}
}

.strip{display:flex;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--bg2);overflow-x:auto;flex-shrink:0;scrollbar-width:none}
.strip::-webkit-scrollbar{display:none}
.strip-item{display:flex;flex-direction:column;gap:2px;padding:7px 13px;border-right:1px solid var(--border);flex-shrink:0}
.strip-item:last-child{border-right:none}
.s-sym{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3);letter-spacing:1px}
.s-price{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:500;color:var(--text)}
.s-chg{font-size:10px;font-weight:600}.up{color:var(--green)}.dn{color:var(--red)}
.chat{background:var(--bg2);border-top:1px solid var(--border);display:flex;flex-direction:column;max-height:43vh;flex-shrink:0}
.prompts{display:flex;gap:6px;padding:8px 14px 0;overflow-x:auto;scrollbar-width:none;flex-shrink:0}
.prompts::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;background:var(--bg3);border:1px solid var(--border);border-radius:13px;padding:4px 11px;font-size:11px;color:var(--text2);cursor:pointer;white-space:nowrap;font-weight:500}
.chip:active{background:rgba(37,99,235,0.12);border-color:var(--accent);color:var(--accent3)}
.msgs{flex:1;overflow-y:auto;padding:9px 14px;display:flex;flex-direction:column;gap:8px;min-height:60px}
.msgs::-webkit-scrollbar{width:2px}
.msgs::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
.msg{max-width:88%;padding:9px 13px;border-radius:10px;font-size:13px;line-height:1.5}
.msg-u{align-self:flex-end;background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.22);color:var(--text)}
.msg-g{align-self:flex-start;background:var(--bg3);border:1px solid var(--border);color:var(--text)}
.msg-lbl{font-size:8px;color:var(--text3);letter-spacing:2px;font-family:'JetBrains Mono',monospace;margin-bottom:3px}
.thinking{display:flex;gap:3px;align-items:center;padding:3px 0;align-self:flex-start}
.thinking span{width:4px;height:4px;background:var(--accent2);border-radius:50%;animation:th 1.2s infinite}
.thinking span:nth-child(2){animation-delay:.2s}.thinking span:nth-child(3){animation-delay:.4s}
@keyframes th{0%,100%{opacity:0.2;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
.input-row{display:flex;gap:7px;padding:7px 14px 11px;border-top:1px solid var(--border);flex-shrink:0}
.chat-input{flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-family:'Inter',sans-serif;font-size:13px;padding:8px 12px;outline:none;transition:border-color 0.15s}
.chat-input:focus{border-color:var(--accent)}
.chat-input::placeholder{color:var(--text3)}
.send-btn{background:var(--accent);border:none;border-radius:7px;color:white;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;letter-spacing:1px;padding:0 15px;cursor:pointer}
.send-btn:active{opacity:0.75}.send-btn:disabled{opacity:0.3;cursor:not-allowed}
.panel-bar{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0}
.panel-title{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--text2)}
.close-btn{background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--text2);font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:1px;padding:5px 12px;cursor:pointer}
.close-btn:active{background:var(--bg4)}
.panel-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg)}
.panel-body::-webkit-scrollbar{width:2px}
.panel-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
.dcard{background:var(--bg2);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;max-height:380px}
.dcard-head{padding:8px 13px 7px;border-bottom:1px solid var(--border)}
.dcard-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2.5px;color:var(--text3);text-transform:uppercase}
.dcard-body{padding:11px 13px;overflow-y:auto;flex:1;}
.dcard-body::-webkit-scrollbar{width:4px}.dcard-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
.drow{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(39,39,42,0.6)}
.drow:last-child{border-bottom:none}
.dk{font-size:12px;color:var(--text2)}.dv{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text);font-weight:500}
.sgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sbox{background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:11px 12px}
.sn{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:600;color:var(--accent3)}
.sl{font-size:10px;color:var(--text3);margin-top:2px;letter-spacing:0.5px}
.prow{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(39,39,42,0.5)}
.prow:last-child{border-bottom:none}
.pdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.pname{font-family:'JetBrains Mono',monospace;font-size:11px;flex:1;color:var(--text)}
.pmem{font-size:10px;color:var(--text3)}
.strow{display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid rgba(39,39,42,0.5)}
.strow:last-child{border-bottom:none}
.stnm{font-size:12px;flex:1;color:var(--text)}.stwr{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)}
.badge{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:4px;padding:1px 6px;font-size:8px;color:var(--green);font-weight:700;letter-spacing:1px;flex-shrink:0}
.frow{padding:7px 0;border-bottom:1px solid rgba(39,39,42,0.5)}.frow:last-child{border-bottom:none}
.fn{font-size:12px;font-weight:500;color:var(--text);margin-bottom:2px}.fr{font-size:11px;color:var(--text3)}
.pricerow{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(39,39,42,0.5)}
.pricerow:last-child{border-bottom:none}
.psym{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--cyan);width:40px}
.pval{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:500;color:var(--text)}
.pchg{font-size:11px;font-weight:600}
</style>
</head>
<body>
<div id="app">
  <div class="topbar">
    <div class="brand">
      <div class="brand-name">S.O.T.O.S</div>
      <div class="brand-sep"></div>
      <div class="brand-sub">MK1</div>
    </div>
    <div class="topbar-right">
      <div class="live-pill"><div class="live-dot"></div><div class="live-txt">LIVE</div></div>
      <button class="data-btn" onclick="openPanel()">DATA &#8593;</button>
    </div>
  </div>
  <div class="strip">
    <div class="strip-item"><div class="s-sym">BTC</div><div class="s-price" id="p-BTC">--</div><div class="s-chg" id="c-BTC">--</div></div>
    <div class="strip-item"><div class="s-sym">ETH</div><div class="s-price" id="p-ETH">--</div><div class="s-chg" id="c-ETH">--</div></div>
    <div class="strip-item"><div class="s-sym">SOL</div><div class="s-price" id="p-SOL">--</div><div class="s-chg" id="c-SOL">--</div></div>
    <div class="strip-item"><div class="s-sym">XRP</div><div class="s-price" id="p-XRP">--</div><div class="s-chg" id="c-XRP">--</div></div>
    <div class="strip-item"><div class="s-sym">LINK</div><div class="s-price" id="p-LINK">--</div><div class="s-chg" id="c-LINK">--</div></div>
    <div class="strip-item"><div class="s-sym">LTC</div><div class="s-price" id="p-LTC">--</div><div class="s-chg" id="c-LTC">--</div></div>
    <div class="strip-item"><div class="s-sym">ETH/BTC</div><div class="s-price" id="p-ETHBTC">--</div><div class="s-chg" id="c-ETHBTC">--</div></div>
  </div>
  
  <div class="main-content">
    <div class="left-pane">
      <div class="stage">
        <canvas id="golem-canvas" width="260" height="260"></canvas>
        <div class="golem-label">G O L E M</div>
        <div class="golem-state" id="golem-state">Initialising...</div>
        <div class="regime-badge" id="regime-badge">RANGING</div>
      </div>
      <div class="chat">
        <div class="prompts">
          <div class="chip" onclick="sendPrompt(this)">What is the market doing?</div>
          <div class="chip" onclick="sendPrompt(this)">Should I trade right now?</div>
          <div class="chip" onclick="sendPrompt(this)">Give me a system summary</div>
          <div class="chip" onclick="sendPrompt(this)">What regime are we in?</div>
        </div>
        <div class="msgs" id="msgs">
          <div class="msg msg-g">
            <div class="msg-lbl">GOLEM</div>
            <div>System online. Full platform visibility active. Ask me anything.</div>
          </div>
        </div>
        <div class="input-row">
          <input class="chat-input" id="chat-input" placeholder="Ask GOLEM..." onkeydown="if(event.key==='Enter')sendMsg()">
          <button class="send-btn" id="send-btn" onclick="sendMsg()">SEND</button>
        </div>
      </div>
    </div>
    
    <div id="panel">
      <div class="panel-bar">
        <div class="panel-title">SYSTEM INTELLIGENCE</div>
        <button class="close-btn" onclick="closePanel()">CLOSE &#8595;</button>
      </div>
      <div class="panel-body">
        <div class="sgrid">
          <div class="sbox"><div class="sn" id="d-regime">--</div><div class="sl">MARKET REGIME</div></div>
          <div class="sbox"><div class="sn" id="d-checks">--</div><div class="sl">MONITOR CHECKS</div></div>
        </div>
        <div class="dcard full-width">
          <div class="dcard-head"><div class="dcard-lbl">Strategy Performance (Returns %)</div></div>
          <div class="dcard-body" style="height:220px;overflow:hidden;padding-top:16px"><canvas id="perfChart"></canvas></div>
        </div>
        <div class="dcard">
          <div class="dcard-head"><div class="dcard-lbl">System Memory (MB)</div></div>
          <div class="dcard-body" style="height:190px;overflow:hidden;padding:16px"><canvas id="memChart"></canvas></div>
        </div>
        <div class="dcard"><div class="dcard-head"><div class="dcard-lbl">PM2 Processes</div></div><div class="dcard-body" id="d-pm2"></div></div>
        <div class="dcard"><div class="dcard-head"><div class="dcard-lbl">Praximous Swarm Alerts</div></div><div class="dcard-body" id="d-praximous"></div></div>
        <div class="dcard"><div class="dcard-head"><div class="dcard-lbl">Live Prices</div></div><div class="dcard-body" id="d-prices"></div></div>
        <div class="dcard">
          <div class="dcard-head"><div class="dcard-lbl">Active Strategy</div></div>
          <div class="dcard-body">
            <div class="drow"><span class="dk">Strategy</span><span class="dv" id="d-strat">--</span></div>
            <div class="drow"><span class="dk">Phase</span><span class="dv" id="d-phase">--</span></div>
            <div class="drow"><span class="dk">Sentiment</span><span class="dv" id="d-sent">--</span></div>
            <div class="drow"><span class="dk">Trades</span><span class="dv" id="d-trades">--</span></div>
          </div>
        </div>
        <div class="dcard full-width"><div class="dcard-head"><div class="dcard-lbl">Strategy Pool</div></div><div class="dcard-body" id="d-pool"></div></div>
        <div class="dcard"><div class="dcard-head"><div class="dcard-lbl">Failure Memory</div></div><div class="dcard-body" id="d-fails"></div></div>
        <div class="dcard">
          <div class="dcard-head"><div class="dcard-lbl">Pharaoh -- XRP Sentinel</div></div>
          <div class="dcard-body">
            <div class="drow"><span class="dk">Status</span><span class="dv" id="d-ph-st">--</span></div>
            <div class="drow"><span class="dk">XRP Price</span><span class="dv" id="d-ph-px">--</span></div>
            <div class="drow"><span class="dk">Fear and Greed</span><span class="dv" id="d-ph-fg">--</span></div>
            <div class="drow"><span class="dk">RSI</span><span class="dv" id="d-ph-rsi">--</span></div>
            <div class="drow"><span class="dk">Mode</span><span class="dv" style="color:var(--gold)">DRY RUN</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
var REGIME_COLORS={RANGING:'#2563eb',TRENDING_UP:'#10b981',TRENDING_DOWN:'#ef4444',VOLATILE:'#f59e0b',UNKNOWN:'#6366f1'};
var MODES={idle:{label:'Ready.',eyeSpd:0.038,breathe:0.013,mouth:0,scanSpd:1.0,ring:false,stream:false},think:{label:'Analysing...',eyeSpd:0.060,breathe:0.008,mouth:0,scanSpd:2.2,ring:false,stream:true},speak:{label:'Processing...',eyeSpd:0.055,breathe:0.010,mouth:1,scanSpd:1.5,ring:false,stream:false},alert:{label:'Signal detected.',eyeSpd:0.080,breathe:0.020,mouth:0,scanSpd:3.0,ring:true,stream:false}};
var tick=0,currentMode='idle',currentRegime='RANGING',currentLosses=0,lastVol=0,lastFails=0,stateMsg='',bootComplete=false;
window.GOLEM={
  setIdle:function(m){currentMode='idle';stateMsg=m||'';this._sync();},
  setThinking:function(m){currentMode='think';stateMsg=m||'';this._sync();},
  setSpeaking:function(m){currentMode='speak';stateMsg=m||'';this._sync();},
  setAlert:function(m){currentMode='alert';stateMsg=m||'';this._sync();},
  setRegime:function(r){
    currentRegime=r||'RANGING';
    var col=REGIME_COLORS[currentRegime]||REGIME_COLORS.RANGING;
    var badge=document.getElementById('regime-badge');
    if(badge){badge.textContent=currentRegime.replace('_',' ');badge.style.color=col;badge.style.borderColor=col+'44';badge.style.background=col+'12';}
    var st=document.getElementById('golem-state');if(st)st.style.color=col;
  },
  setMessage:function(m){stateMsg=m;this._sync();},
  _sync:function(){
    var m=MODES[currentMode],col=REGIME_COLORS[currentRegime]||REGIME_COLORS.RANGING;
    var el=document.getElementById('golem-state');
    if(el){el.textContent=stateMsg||m.label;el.style.color=col;}
  }
};

var canvas=document.getElementById('golem-canvas');
var ctx2=canvas.getContext('2d');
var W=260,H=260,cx=130,cy=126;

function h2(o){return Math.round(Math.max(0,Math.min(255,o*255))).toString(16).padStart(2,'0');}
function pp(pts){ctx2.beginPath();ctx2.moveTo(pts[0][0],pts[0][1]);for(var i=1;i<pts.length;i++)ctx2.lineTo(pts[i][0],pts[i][1]);ctx2.closePath();}
function ng(x,y,r,n,rot){var p=[];for(var i=0;i<n;i++){var a=rot+(2*Math.PI*i)/n;p.push([x+r*Math.cos(a),y+r*Math.sin(a)]);}return p;}

function drawGolem(){
  ctx2.clearRect(0,0,W,H);
  var mode=MODES[currentMode],col=REGIME_COLORS[currentRegime]||REGIME_COLORS.RANGING;
  var br=Math.sin(tick*0.020)*mode.breathe;
  var ep=0.45+Math.abs(Math.sin(tick*mode.eyeSpd))*0.55;
  var ep2=0.40+Math.abs(Math.sin(tick*mode.eyeSpd*1.15+0.9))*0.6;
  var sy=cy-88+((tick*mode.scanSpd%140)/140)*176;
  var ma=mode.mouth*Math.abs(Math.sin(tick*0.12))*9;
  ctx2.save();ctx2.translate(cx,cy);ctx2.scale(1+br,1+br*0.7);ctx2.translate(-cx,-cy);
  for(var i=3;i>0;i--){var g=ctx2.createRadialGradient(cx,cy,38*i,cx,cy,65*i);g.addColorStop(0,col+h2(0.035/i));g.addColorStop(1,'transparent');ctx2.fillStyle=g;ctx2.beginPath();ctx2.arc(cx,cy,65*i,0,Math.PI*2);ctx2.fill();}
  if(mode.ring){var rp=(tick%55)/55;[1.15,1.35].forEach(function(sc,i){ctx2.beginPath();ctx2.arc(cx,cy,90*sc+rp*18,0,Math.PI*2);ctx2.strokeStyle=col+h2((1-rp)*(0.28-i*0.1));ctx2.lineWidth=1.5-i*0.5;ctx2.stroke();});}
  var R=90,face=ng(cx,cy,R,8,Math.PI/2);
  ctx2.shadowColor=col;ctx2.shadowBlur=20;pp(face);ctx2.strokeStyle=col+h2(0.32);ctx2.lineWidth=0.8;ctx2.stroke();ctx2.shadowBlur=0;
  var fill=ctx2.createRadialGradient(cx,cy-16,8,cx,cy,R);fill.addColorStop(0,'#0e1015');fill.addColorStop(1,'#09090b');pp(face);ctx2.fillStyle=fill;ctx2.fill();
  pp(face);ctx2.strokeStyle=col+h2(0.70);ctx2.lineWidth=2;ctx2.stroke();
  pp(ng(cx,cy,R-4,8,Math.PI/2));ctx2.strokeStyle=col+h2(0.09);ctx2.lineWidth=1;ctx2.stroke();
  [0.70,0.50,0.32].forEach(function(s,i){pp(ng(cx,cy,R*s,8,Math.PI/2+(i%2?Math.PI/8:0)));ctx2.strokeStyle=col+h2(0.05+i*0.02);ctx2.lineWidth=0.6;ctx2.stroke();});
  face.forEach(function(pt,i){ctx2.beginPath();ctx2.moveTo(cx,cy);ctx2.lineTo(pt[0],pt[1]);ctx2.strokeStyle=col+h2(0.04);ctx2.lineWidth=0.5;ctx2.stroke();if(i%2===0){var mx=cx+(pt[0]-cx)*0.54,my=cy+(pt[1]-cy)*0.54;ctx2.beginPath();ctx2.arc(mx,my,1.5,0,Math.PI*2);ctx2.fillStyle=col+h2(0.28);ctx2.fill();}});
  for(var i=0;i<4;i++){ctx2.beginPath();ctx2.moveTo(face[i][0],face[i][1]);ctx2.lineTo(face[i+4][0],face[i+4][1]);ctx2.strokeStyle=col+h2(0.04);ctx2.lineWidth=0.5;ctx2.stroke();}
  ctx2.beginPath();ctx2.moveTo(cx-40,cy-26);ctx2.bezierCurveTo(cx-25,cy-39,cx-7,cy-43,cx,cy-42);ctx2.bezierCurveTo(cx+7,cy-43,cx+25,cy-39,cx+40,cy-26);ctx2.strokeStyle=col+h2(0.76);ctx2.lineWidth=1.8;ctx2.stroke();
  ctx2.beginPath();ctx2.moveTo(cx-34,cy-24);ctx2.bezierCurveTo(cx-20,cy-35,cx-5,cy-38,cx,cy-37);ctx2.bezierCurveTo(cx+5,cy-38,cx+20,cy-35,cx+34,cy-24);ctx2.strokeStyle=col+h2(0.16);ctx2.lineWidth=1;ctx2.stroke();
  [[-40,-26,-1],[40,-26,1]].forEach(function(d){ctx2.beginPath();ctx2.moveTo(cx+d[0],cy+d[1]);ctx2.lineTo(cx+d[0]+d[2]*7,cy+d[1]-4);ctx2.lineTo(cx+d[0]+d[2]*7,cy+d[1]+5);ctx2.strokeStyle=col+h2(0.42);ctx2.lineWidth=1.2;ctx2.stroke();});
  for(var i=-2;i<=2;i++){ctx2.beginPath();ctx2.moveTo(cx+i*10,cy-36-Math.abs(i)*2);ctx2.lineTo(cx+i*10,cy-41-Math.abs(i)*2);ctx2.strokeStyle=col+h2(0.20+Math.abs(i)*0.04);ctx2.lineWidth=1;ctx2.stroke();}
  [[cx-26,cy-8,ep],[cx+26,cy-8,ep2]].forEach(function(eye){
    var ex=eye[0],ey=eye[1],e=eye[2];
    pp(ng(ex,ey,16,6,Math.PI/6));ctx2.strokeStyle=col+h2(e*0.26);ctx2.lineWidth=0.7;ctx2.stroke();
    ctx2.beginPath();ctx2.moveTo(ex,ey-12);ctx2.lineTo(ex+12,ey);ctx2.lineTo(ex,ey+12);ctx2.lineTo(ex-12,ey);ctx2.closePath();
    ctx2.shadowColor=col;ctx2.shadowBlur=10;ctx2.strokeStyle=col+h2(e*0.86);ctx2.lineWidth=2;ctx2.stroke();ctx2.shadowBlur=0;
    ctx2.beginPath();ctx2.moveTo(ex,ey-7);ctx2.lineTo(ex+7,ey);ctx2.lineTo(ex,ey+7);ctx2.lineTo(ex-7,ey);ctx2.closePath();ctx2.strokeStyle=col+h2(e*0.42);ctx2.lineWidth=1;ctx2.stroke();
    [[0,-12],[12,0],[0,12],[-12,0]].forEach(function(d){var nx=d[0]===0?0:(d[0]>0?1:-1),ny=d[1]===0?0:(d[1]>0?1:-1);ctx2.beginPath();ctx2.moveTo(ex+d[0],ey+d[1]);ctx2.lineTo(ex+d[0]+nx*5,ey+d[1]+ny*5);ctx2.strokeStyle=col+h2(e*0.36);ctx2.lineWidth=1;ctx2.stroke();});
    var ig=ctx2.createRadialGradient(ex,ey,0,ex,ey,10);ig.addColorStop(0,col+h2(e*0.38));ig.addColorStop(0.6,col+h2(e*0.10));ig.addColorStop(1,'transparent');
    ctx2.beginPath();ctx2.moveTo(ex,ey-12);ctx2.lineTo(ex+12,ey);ctx2.lineTo(ex,ey+12);ctx2.lineTo(ex-12,ey);ctx2.closePath();ctx2.fillStyle=ig;ctx2.fill();
    ctx2.beginPath();ctx2.arc(ex,ey,4.8,0,Math.PI*2);ctx2.strokeStyle=col+h2(e*0.62);ctx2.lineWidth=1.2;ctx2.stroke();
    ctx2.beginPath();ctx2.arc(ex,ey,2.6,0,Math.PI*2);ctx2.fillStyle=col+h2(e*0.90);ctx2.fill();
    ctx2.beginPath();ctx2.arc(ex,ey,1.1,0,Math.PI*2);ctx2.fillStyle='#09090b';ctx2.fill();
    var gx=ex-3+Math.sin(tick*0.028)*1.5;ctx2.beginPath();ctx2.arc(gx,ey-3.5,0.9,0,Math.PI*2);ctx2.fillStyle='#ffffff'+h2(e*0.48);ctx2.fill();
  });
  ctx2.beginPath();ctx2.moveTo(cx,cy-1);ctx2.lineTo(cx-8,cy+14);ctx2.lineTo(cx+8,cy+14);ctx2.strokeStyle=col+h2(0.26);ctx2.lineWidth=1.2;ctx2.stroke();
  [3,9].forEach(function(y){ctx2.beginPath();ctx2.moveTo(cx-y*0.5,cy+y);ctx2.lineTo(cx+y*0.5,cy+y);ctx2.strokeStyle=col+h2(0.12);ctx2.lineWidth=0.8;ctx2.stroke();});
  [[-10,14,-1],[10,14,1]].forEach(function(d){ctx2.beginPath();ctx2.moveTo(cx+d[0],cy+d[1]);ctx2.quadraticCurveTo(cx+d[0]+d[2]*6,cy+d[1]+2,cx+d[0]+d[2]*4,cy+d[1]+6);ctx2.strokeStyle=col+h2(0.20);ctx2.lineWidth=1;ctx2.stroke();});
  var my=cy+39;
  ctx2.beginPath();ctx2.moveTo(cx-20,my);ctx2.bezierCurveTo(cx-11,my-2+ma*0.3,cx-5,my-4,cx,my-4);ctx2.bezierCurveTo(cx+5,my-4,cx+11,my-2+ma*0.3,cx+20,my);ctx2.strokeStyle=col+h2(0.70);ctx2.lineWidth=1.8;ctx2.stroke();
  if(ma>2){ctx2.beginPath();ctx2.moveTo(cx-16,my+2);ctx2.bezierCurveTo(cx-7,my+2+ma,cx,my+2+ma,cx+7,my+2+ma);ctx2.bezierCurveTo(cx+13,my+2+ma*0.8,cx+16,my+2,cx+16,my+2);ctx2.strokeStyle=col+h2(0.32);ctx2.lineWidth=1.2;ctx2.stroke();}
  [[-20,0],[20,0]].forEach(function(d){ctx2.beginPath();ctx2.arc(cx+d[0],my,1.8,0,Math.PI*2);ctx2.fillStyle=col+h2(0.40);ctx2.fill();});
  ctx2.beginPath();ctx2.moveTo(cx-13,my+10);ctx2.lineTo(cx,my+13);ctx2.lineTo(cx+13,my+10);ctx2.strokeStyle=col+h2(0.16);ctx2.lineWidth=1;ctx2.stroke();
  [[cx-54,cy+4,-1],[cx+54,cy+4,1]].forEach(function(ck){
    var px=ck[0],py=ck[1],sg=ck[2];
    var cp=[[px,py-18],[px+sg*16,py-8],[px+sg*19,py+3],[px+sg*13,py+16],[px,py+14],[px-sg*5,py+3]];
    pp(cp);ctx2.fillStyle=col+h2(0.04);ctx2.fill();pp(cp);ctx2.strokeStyle=col+h2(0.18);ctx2.lineWidth=1;ctx2.stroke();
    ctx2.beginPath();ctx2.moveTo(px+sg*3,py-12);ctx2.lineTo(px+sg*13,py+2);ctx2.lineTo(px+sg*7,py+12);ctx2.strokeStyle=col+h2(0.12);ctx2.lineWidth=0.7;ctx2.stroke();
    [[0,0],[sg*7,4],[sg*3,8]].forEach(function(dd){ctx2.beginPath();ctx2.arc(px+sg*5+dd[0],py+1+dd[1],1.4,0,Math.PI*2);ctx2.fillStyle=col+h2(0.32);ctx2.fill();});
  });
  [[cx-70,cy-12,-1],[cx+70,cy-12,1]].forEach(function(t){
    var tx=t[0],ty=t[1],sg=t[2];
    [[[tx,ty],[tx+sg*10,ty]],[[tx+sg*10,ty],[tx+sg*10,ty-8]],[[tx+sg*10,ty-8],[tx+sg*19,ty-8]],[[tx+sg*10,ty],[tx+sg*10,ty+8]],[[tx+sg*10,ty+8],[tx+sg*17,ty+8]]].forEach(function(ln){ctx2.beginPath();ctx2.moveTo(ln[0][0],ln[0][1]);ctx2.lineTo(ln[1][0],ln[1][1]);ctx2.strokeStyle=col+h2(0.22);ctx2.lineWidth=0.8;ctx2.stroke();});
    [[tx+sg*10,ty-8],[tx+sg*19,ty-8],[tx+sg*10,ty+8],[tx+sg*17,ty+8],[tx+sg*10,ty]].forEach(function(n){ctx2.beginPath();ctx2.arc(n[0],n[1],1.6,0,Math.PI*2);ctx2.fillStyle=col+h2(0.38);ctx2.fill();});
    var pv=0.26+Math.sin(tick*0.07+tx*0.01)*0.26;ctx2.beginPath();ctx2.arc(tx+sg*19,ty-8,2.5,0,Math.PI*2);ctx2.fillStyle=col+h2(pv);ctx2.fill();
    var pg=ctx2.createRadialGradient(tx+sg*19,ty-8,0,tx+sg*19,ty-8,7);pg.addColorStop(0,col+h2(pv*0.45));pg.addColorStop(1,'transparent');ctx2.fillStyle=pg;ctx2.fill();
  });
  var crY=cy-93,cr=[[cx-22,crY+8],[cx-11,crY],[cx,crY-6],[cx+11,crY],[cx+22,crY+8]];
  ctx2.beginPath();ctx2.moveTo(cr[0][0],cr[0][1]);cr.slice(1).forEach(function(p){ctx2.lineTo(p[0],p[1]);});ctx2.strokeStyle=col+h2(0.40);ctx2.lineWidth=1.5;ctx2.stroke();
  cr.forEach(function(p,i){
    var gs=i===2?4.5:3,ge=i===2?ep:ep*0.62;
    ctx2.shadowColor=col;ctx2.shadowBlur=i===2?12:6;ctx2.beginPath();ctx2.arc(p[0],p[1],gs,0,Math.PI*2);ctx2.fillStyle=col+h2(ge*0.85);ctx2.fill();ctx2.shadowBlur=0;
    var gg=ctx2.createRadialGradient(p[0],p[1],0,p[0],p[1],gs*2.4);gg.addColorStop(0,col+h2(ge*0.42));gg.addColorStop(1,'transparent');ctx2.fillStyle=gg;ctx2.fill();
    if(i===0||i===4){var fp=i===0?face[7]:face[1];ctx2.beginPath();ctx2.moveTo(p[0],p[1]);ctx2.lineTo(fp[0],fp[1]);ctx2.strokeStyle=col+h2(0.12);ctx2.lineWidth=0.8;ctx2.stroke();}
  });
  ctx2.beginPath();ctx2.moveTo(cx,crY-12);ctx2.lineTo(cx+5,crY-6);ctx2.lineTo(cx,crY);ctx2.lineTo(cx-5,crY-6);ctx2.closePath();ctx2.strokeStyle=col+h2(ep*0.62);ctx2.lineWidth=1.2;ctx2.stroke();ctx2.fillStyle=col+h2(ep*0.12);ctx2.fill();
  ctx2.beginPath();ctx2.moveTo(cx-26,cy-48);ctx2.lineTo(cx-15,cy-55);ctx2.lineTo(cx,cy-58);ctx2.lineTo(cx+15,cy-55);ctx2.lineTo(cx+26,cy-48);ctx2.strokeStyle=col+h2(0.14);ctx2.lineWidth=1;ctx2.stroke();
  [cx-14,cx,cx+14].forEach(function(fx,i){var fy=i===1?cy-52:cy-50,fe=i===1?ep:ep*0.42;ctx2.beginPath();ctx2.arc(fx,fy,i===1?2.0:1.5,0,Math.PI*2);ctx2.fillStyle=col+h2(fe*0.52);ctx2.fill();});
  if(currentMode==='think'){for(var i=0;i<8;i++){var dy=((tick*1.8+i*20)%184)-92,dxa=cx-74+i*7,al=Math.max(0,1-Math.abs(dy)/92)*0.42;ctx2.beginPath();ctx2.arc(dxa,cy+dy,1.1,0,Math.PI*2);ctx2.fillStyle=col+h2(al);ctx2.fill();}}
  var sa=0.048+Math.sin(tick*0.04)*0.022;
  var slg=ctx2.createLinearGradient(cx-R,sy,cx+R,sy);slg.addColorStop(0,'transparent');slg.addColorStop(0.2,col+h2(sa*1.4));slg.addColorStop(0.5,col+h2(sa*2.8));slg.addColorStop(0.8,col+h2(sa*1.4));slg.addColorStop(1,'transparent');
  ctx2.beginPath();ctx2.moveTo(cx-R,sy);ctx2.lineTo(cx+R,sy);ctx2.strokeStyle=slg;ctx2.lineWidth=1.4;ctx2.stroke();
  ctx2.restore();tick++;requestAnimationFrame(drawGolem);
}

var appState={},ws;
function openPanel(){document.getElementById('panel').classList.add('open');}
function closePanel(){document.getElementById('panel').classList.remove('open');}
function connectWS(){ws=new WebSocket('ws://'+location.host);ws.onmessage=function(e){appState=Object.assign(appState||{},JSON.parse(e.data));updateAll();};ws.onclose=function(){setTimeout(connectWS,3000);};}
function set(id,val){var el=document.getElementById(id);if(el)el.textContent=val;}
function updateAll(){
  if(!appState)return;
  var m=appState.market||{},ph=appState.pharaoh||{},mn=appState.monitor||{};
  var syms=['BTC','ETH','SOL','XRP','LINK','LTC','ETHBTC'];
  if(mn && mn.consecutiveLosses !== undefined){
    if(bootComplete && mn.consecutiveLosses >= 3 && currentLosses < 3){
      addMsg('🛑 CRITICAL ALERT: Sentinel agent reports ' + mn.consecutiveLosses + ' consecutive losses. Initiating Aegis Lock 2 revocation protocol.', 'g');
      GOLEM.setAlert('Risk Detected!');
      setTimeout(function(){ GOLEM.setIdle('Ready.'); }, 5000);
    }
    currentLosses = mn.consecutiveLosses;
  }
  if(m.volumeRatio !== undefined){
    if(bootComplete && m.volumeRatio > 2.0 && lastVol <= 2.0){
      addMsg('🚨 SCOUT ALERT: Massive volume spike detected (' + m.volumeRatio.toFixed(2) + 'x normal). Market volatility increasing.', 'g');
      GOLEM.setAlert('Volume Spike!');
      setTimeout(function(){ GOLEM.setIdle('Ready.'); }, 5000);
    }
    lastVol = m.volumeRatio;
  }
  if(appState.total_failures !== undefined){
    if(bootComplete && appState.total_failures > 10 && lastFails <= 10){
      addMsg('⚠️ FORGE MASTER ALERT: ' + appState.total_failures + ' consecutive validation failures. Reasoning engine stalling. Suggesting parameter mutation injection.', 'g');
      GOLEM.setAlert('Forge Stalled!');
      setTimeout(function(){ GOLEM.setIdle('Ready.'); }, 5000);
    }
    lastFails = appState.total_failures;
  }
  if(m.regime){
    if(bootComplete && currentRegime !== m.regime){
      addMsg('⚠️ TACTICAL ALERT: Market regime shift detected. Transitioned from ' + currentRegime + ' to ' + m.regime + '. Adjusting parameters.', 'g');
      GOLEM.setAlert('Regime Shift!');
      setTimeout(function(){ GOLEM.setIdle('Ready.'); }, 5000);
    }
    GOLEM.setRegime(m.regime);
  }
  syms.forEach(function(s){
    var p=appState.prices&&appState.prices[s];if(!p)return;
    set('p-'+s,(s==='ETHBTC'?'\u20BF':'$')+p.price.toLocaleString(undefined,{maximumFractionDigits:4}));
    var cel=document.getElementById('c-'+s);
    if(cel){cel.textContent=(p.change>=0?'+':'')+p.change.toFixed(2)+'%';cel.className='s-chg '+(p.change>=0?'up':'dn');}
  });
  set('d-regime',m.regime||'--');set('d-checks',(mn.checks||0).toLocaleString());
  var pl=document.getElementById('d-prices');
  if(pl&&appState.prices){pl.innerHTML=syms.map(function(s){var p=appState.prices[s];if(!p)return'';return'<div class="pricerow"><span class="psym">'+(s==='ETHBTC'?'ETH/BTC':s)+'</span><span class="pval">'+(s==='ETHBTC'?'\u20BF':'$')+p.price.toLocaleString(undefined,{maximumFractionDigits:4})+'</span><span class="pchg '+(p.change>=0?'up':'dn')+'">'+(p.change>=0?'+':'')+p.change.toFixed(2)+'%</span></div>';}).join('');}
  set('d-strat',appState.strategy&&appState.strategy.name||'--');
  set('d-phase',m.phase||'--');set('d-sent',m.sentiment||'--');set('d-trades',(mn.trades||0).toString());
  set('d-ph-st',ph.currentState||'--');set('d-ph-px',ph.xrpPrice?'$'+ph.xrpPrice.toFixed(4):'--');
  set('d-ph-fg',ph.fearGreed!==undefined?ph.fearGreed+'/100':'--');set('d-ph-rsi',ph.rsi?ph.rsi.toFixed(1):'--');
  var sp=document.getElementById('d-pool');
  if(sp&&appState.strategies){sp.innerHTML=appState.strategies.slice(0,6).map(function(s){return'<div class="strow"><span class="stnm">'+s.name+'</span>'+(s.active?'<span class="badge">ACTIVE</span>':'')+(s.wr?'<span class="stwr">'+s.wr+'</span>':'')+'</div>';}).join('')||'<div style="color:var(--text3);font-size:12px">No strategies</div>';}
  var px=document.getElementById('d-praximous');
  if(px){px.innerHTML=appState.praximous_alerts&&appState.praximous_alerts.length?appState.praximous_alerts.slice(0,5).map(function(a){var timeStr=new Date(a.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return'<div class="frow"><div class="fn">'+a.icon+' '+a.agent+'<span style="float:right;font-size:9px;color:var(--text3);font-weight:normal;margin-top:2px">'+timeStr+'</span></div><div class="fr">'+a.message+'</div></div>';}).join(''):'<div style="color:var(--text3);font-size:12px;padding:4px 0">No recent alerts</div>';}
  var pp2=document.getElementById('d-pm2');
  if(pp2&&appState.pm2){pp2.innerHTML=appState.pm2.map(function(p){var on=p.status==='online',col=on?'var(--green)':'var(--red)';return'<div class="prow"><div class="pdot" style="background:'+col+';box-shadow:0 0 4px '+col+'"></div><span class="pname">'+p.name+'</span><span class="pmem">'+(on?p.memory+'mb':p.status)+'</span></div>';}).join('');}
  var ff=document.getElementById('d-fails');
  if(ff){ff.innerHTML=appState.failures&&appState.failures.length?appState.failures.map(function(f){return'<div class="frow"><div class="fn">'+f.name+'</div><div class="fr">'+f.reason+'</div></div>';}).join(''):'<div style="color:var(--text3);font-size:12px;padding:4px 0">No failures recorded</div>';}
  
  // Render Charts
  if(window.Chart) {
    Chart.defaults.color = '#a1a1aa';
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    
    var pCtx = document.getElementById('perfChart');
    if(pCtx && appState.strategies && appState.strategies.length > 0) {
      var lbls = appState.strategies.map(function(s){return s.name.substring(0,18)});
      var dts = appState.strategies.map(function(s){return parseFloat(s.ret)||0});
      var bgs = dts.map(function(d){return d>=0?'rgba(16,185,129,0.7)':'rgba(239,68,68,0.7)'});
      var bds = dts.map(function(d){return d>=0?'#10b981':'#ef4444'});
      if(!window.pChart) {
        window.pChart = new Chart(pCtx, {
          type:'bar', data:{labels:lbls,datasets:[{data:dts,backgroundColor:bgs,borderColor:bds,borderWidth:1}]},
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'#27272a'}},x:{grid:{display:false}}}}
        });
      } else {
        window.pChart.data.labels=lbls; window.pChart.data.datasets[0].data=dts;
        window.pChart.data.datasets[0].backgroundColor=bgs; window.pChart.data.datasets[0].borderColor=bds;
        window.pChart.update();
      }
    }
    
    var mCtx = document.getElementById('memChart');
    if(mCtx && appState.pm2) {
      var mlbls = appState.pm2.map(function(p){return p.name});
      var mdts = appState.pm2.map(function(p){return p.memory});
      if(!window.mChart) {
        window.mChart = new Chart(mCtx, {
          type:'doughnut', data:{labels:mlbls,datasets:[{data:mdts,backgroundColor:['#3b82f6','#10b981','#f59e0b','#8b5cf6','#6366f1'],borderWidth:0}]},
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10}}}},cutout:'70%'}
        });
      } else {
        window.mChart.data.labels=mlbls; window.mChart.data.datasets[0].data=mdts;
        window.mChart.update();
      }
    }
  }
}
function sendMsg(){var inp=document.getElementById('chat-input'),msg=inp.value.trim();if(!msg)return;inp.value='';addMsg(msg,'u');callGolem(msg);}
function sendPrompt(el){addMsg(el.textContent,'u');callGolem(el.textContent);}
function addMsg(text,role){var c=document.getElementById('msgs'),d=document.createElement('div');d.className='msg msg-'+(role==='u'?'u':'g');if(role!=='u'){var l=document.createElement('div');l.className='msg-lbl';l.textContent='GOLEM';d.appendChild(l);}var t=document.createElement('div');t.textContent=text;d.appendChild(t);c.appendChild(d);c.scrollTop=c.scrollHeight;}
function addThink(){var c=document.getElementById('msgs'),d=document.createElement('div');d.className='thinking';d.id='think';d.innerHTML='<span></span><span></span><span></span>';c.appendChild(d);c.scrollTop=c.scrollHeight;}
function rmThink(){var el=document.getElementById('think');if(el)el.remove();}
async function callGolem(msg){
  var btn=document.getElementById('send-btn');btn.disabled=true;GOLEM.setSpeaking('Processing...');addThink();
  try{var res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})});var data=await res.json();rmThink();addMsg(data.response||'No response.','g');GOLEM.setIdle('Ready.');}
  catch(e){rmThink();addMsg('Connection error.','g');GOLEM.setIdle('Error.');}
  btn.disabled=false;
}
async function init(){
  drawGolem();
  try{var res=await fetch('/api/state');appState=await res.json();updateAll();var regime=(appState.market&&appState.market.regime)||'RANGING';GOLEM.setRegime(regime);GOLEM.setIdle('Ready  --  '+regime+' market detected');}
  catch(e){GOLEM.setIdle('Ready.');}
  connectWS();
  bootComplete=true;
}
init();
</script>
</body>
</html>`; }

server.listen(PORT, () => {
  console.log('\n' + '═'.repeat(50));
  console.log('🔮 S.O.T.O.S DASHBOARD — GOLEM v3 ACTIVE');
  console.log('═'.repeat(50));
  console.log('📍 URL:    http://localhost:' + PORT);
  console.log('🧠 Gemini: ' + (process.env.GEMINI_API_KEY ? '✅ Configured (gemini-2.5-flash)' : '❌ NOT configured'));
  console.log('═'.repeat(50) + '\n');
});
