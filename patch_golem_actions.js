#!/usr/bin/env node
/**
 * patch_golem_actions.js
 * Adds action execution to GOLEM chat.
 * Quick actions run synchronously, long actions run in background.
 */

const fs = require('fs');
const FILE = 'forge-dashboard.js';
let c = fs.readFileSync(FILE, 'utf8');

// ── 1. Add action endpoint after /api/chat route ───────────────────────────────

const chatRouteEnd = `  res.json({ response });
});`;

const actionRoute = `  res.json({ response });
});

// ── Action endpoint ────────────────────────────────────────────────────────────

const { spawn, execSync } = require('child_process');

const ACTIONS = {
  auto_loop: {
    label: 'Running Forge auto loop (5 iterations)...',
    background: true,
    run: () => {
      const child = spawn('node', ['forge_auto.js', '5'], { cwd: BASE, detached: true, stdio: 'ignore' });
      child.unref();
      return 'Forge auto loop started in background. Check monitor logs in a few minutes.';
    }
  },
  evolution: {
    label: 'Running evolution engine...',
    background: true,
    run: () => {
      const child = spawn('node', ['forge-evolution.js'], { cwd: BASE, detached: true, stdio: 'ignore' });
      child.unref();
      return 'Evolution engine started in background. 5 generations across 20 individuals. Results in evolution_log.json.';
    }
  },
  pharaoh_logs: {
    label: 'Checking Pharaoh logs...',
    background: false,
    run: () => {
      try {
        const out = execSync('pm2 logs pharaoh --lines 15 --nostream', { encoding: 'utf8', timeout: 5000 });
        const lines = out.split('\\n').filter(l => l.includes('pharaoh')).slice(-10);
        return lines.length ? lines.join('\\n') : 'No recent Pharaoh logs found.';
      } catch (e) {
        const state = readJSON(path.join(HOME, 'golem/test-engines/pharaoh/data/pharaoh-state.json'));
        if (state) return 'Pharaoh: ' + state.currentState + ' | XRP: $' + state.xrpPrice + ' | RSI: ' + state.rsi.toFixed(1) + ' | F&G: ' + state.fearGreed + '/100';
        return 'Could not read Pharaoh logs.';
      }
    }
  },
  monitor_log: {
    label: 'Reading monitor log...',
    background: false,
    run: () => {
      const log = readJSON(path.join(HOME, 'kraken-intelligence/reasoning-bot/data/monitor_log.json'));
      if (!log) return 'No monitor log found.';
      const trades = log.trades || [];
      const wins = trades.filter(t => t.win).length;
      const wr = trades.length ? Math.round(wins / trades.length * 100) : 0;
      let result = 'Monitor: ' + (log.checks || 0) + ' checks | ' + trades.length + ' trades | WR: ' + wr + '%';
      if (trades.length > 0) {
        const last = trades[trades.length - 1];
        result += '\\nLast trade: ' + last.pair + ' ' + (last.pnl_pct >= 0 ? '+' : '') + last.pnl_pct + '% (' + last.reason + ')';
      }
      const positions = Object.keys(log.positions || {});
      if (positions.length) result += '\\nOpen positions: ' + positions.join(', ');
      return result;
    }
  },
  audit: {
    label: 'Reading ChronoScribe audit...',
    background: false,
    run: () => {
      try {
        const out = execSync('node chronoscribe.js --audit', { cwd: BASE, encoding: 'utf8', timeout: 5000 });
        return out.slice(0, 800);
      } catch (e) { return 'Could not read audit log: ' + e.message; }
    }
  },
  dry_run_hypothesis: {
    label: 'Previewing next hypothesis...',
    background: false,
    run: () => {
      try {
        const out = execSync('node forge-reasoning.js --dry-run', { cwd: BASE, encoding: 'utf8', timeout: 15000 });
        const lines = out.split('\\n').filter(l => l.trim() && !l.includes('{') && !l.includes('}') && !l.includes('"'));
        return lines.slice(0, 15).join('\\n');
      } catch (e) { return 'Could not generate hypothesis preview: ' + e.message; }
    }
  },
  regime_state: {
    label: 'Checking regime state...',
    background: false,
    run: () => {
      const state = readJSON(path.join(HOME, 'kraken-intelligence/reasoning-bot/data/regime_state.json'));
      if (!state) return 'No regime state recorded yet. Watcher runs at 6:30am daily.';
      return 'Current regime: ' + state.current_regime + '\\nLast checked: ' + (state.last_checked || 'never') + '\\nLast trigger: ' + (state.last_trigger || 'never');
    }
  },
  system_status: {
    label: 'Checking system status...',
    background: false,
    run: () => {
      try {
        const out = execSync('pm2 jlist', { encoding: 'utf8' });
        const procs = JSON.parse(out);
        const online = procs.filter(p => p.pm2_env.status === 'online').map(p => p.name);
        const stopped = procs.filter(p => p.pm2_env.status !== 'online').map(p => p.name);
        return 'Online: ' + online.join(', ') + '\\nStopped (expected): ' + stopped.join(', ');
      } catch (e) { return 'Could not read PM2 status.'; }
    }
  }
};

const BASE = path.join(HOME, 'kraken-intelligence');

// Intent detection
function detectAction(message) {
  const m = message.toLowerCase();
  if (m.includes('auto loop') || m.includes('generate strateg') || m.includes('run forge') || m.includes('new strateg')) return 'auto_loop';
  if (m.includes('evolv') || m.includes('evolution') || m.includes('genetic')) return 'evolution';
  if (m.includes('pharaoh') && (m.includes('log') || m.includes('check') || m.includes('status') || m.includes('doing'))) return 'pharaoh_logs';
  if (m.includes('monitor log') || m.includes('recent checks') || m.includes('any signal') || m.includes('entry signal')) return 'monitor_log';
  if (m.includes('audit') || m.includes('chronoscribe') || m.includes('signed record')) return 'audit';
  if (m.includes('hypothesis') || m.includes('preview') || m.includes('next strateg') || m.includes('dry run')) return 'dry_run_hypothesis';
  if (m.includes('regime state') || m.includes('regime watcher') || m.includes('regime change')) return 'regime_state';
  if (m.includes('system status') || m.includes('all process') || m.includes('pm2 status') || m.includes('everything running')) return 'system_status';
  return null;
}

app.post('/api/action', (req, res) => {
  const { message } = req.body;
  const actionKey = detectAction(message || '');
  if (!actionKey) return res.json({ response: null, action: null });

  const action = ACTIONS[actionKey];
  console.log('GOLEM action:', actionKey);

  try {
    const result = action.run();
    res.json({ response: result, action: actionKey, background: action.background });
  } catch (e) {
    res.json({ response: 'Action failed: ' + e.message, action: actionKey });
  }
});`;

if (c.includes(chatRouteEnd)) {
  c = c.replace(chatRouteEnd, actionRoute);
  console.log('Added /api/action endpoint');
} else {
  console.log('Could not find chat route end');
  process.exit(1);
}

// ── 2. Update callGolem in frontend to check for actions first ─────────────────

const oldCallGolem = `async function callGolem(message) {
  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  golemSpeaking = true;
  document.getElementById('golem-status').textContent = 'Processing query...';
  addThinking();

  try {
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    removeThinking();
    addMessage(data.response || 'No response received.', 'golem');
    document.getElementById('golem-status').textContent = 'Ready.';
  } catch (e) {
    removeThinking();
    addMessage('Connection error. Check server status.', 'golem');
    document.getElementById('golem-status').textContent = 'Error.';
  }

  golemSpeaking = false;
  btn.disabled = false;
}`;

const newCallGolem = `async function callGolem(message) {
  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  golemSpeaking = true;
  document.getElementById('golem-status').textContent = 'Processing...';
  addThinking();

  try {
    // Check for action intent first
    const actionRes = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const actionData = await actionRes.json();

    if (actionData.action && actionData.response) {
      removeThinking();
      const prefix = actionData.background ? 'Started: ' : '';
      addMessage(prefix + actionData.response, 'golem');
      document.getElementById('golem-status').textContent = actionData.background ? 'Running in background...' : 'Ready.';
      golemSpeaking = false;
      btn.disabled = false;
      return;
    }

    // No action — ask Gemini
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    removeThinking();
    addMessage(data.response || 'No response received.', 'golem');
    document.getElementById('golem-status').textContent = 'Ready.';
  } catch (e) {
    removeThinking();
    addMessage('Connection error. Check server status.', 'golem');
    document.getElementById('golem-status').textContent = 'Error.';
  }

  golemSpeaking = false;
  btn.disabled = false;
}`;

if (c.includes(oldCallGolem)) {
  c = c.replace(oldCallGolem, newCallGolem);
  console.log('Updated callGolem with action detection');
} else {
  console.log('Could not find callGolem function — checking...');
  const idx = c.indexOf('async function callGolem');
  console.log('callGolem at char:', idx);
}

// ── 3. Add action prompt chips ─────────────────────────────────────────────────

const oldChips = `      <div class="chip" onclick="sendPrompt(this)">When will conditions be right?</div>`;
const newChips = `      <div class="chip" onclick="sendPrompt(this)">When will conditions be right?</div>
      <div class="chip" onclick="sendPrompt(this)">Run the auto loop</div>
      <div class="chip" onclick="sendPrompt(this)">Check monitor log</div>
      <div class="chip" onclick="sendPrompt(this)">Check Pharaoh status</div>
      <div class="chip" onclick="sendPrompt(this)">Show audit trail</div>
      <div class="chip" onclick="sendPrompt(this)">Preview next hypothesis</div>
      <div class="chip" onclick="sendPrompt(this)">System status</div>`;

if (c.includes(oldChips)) {
  c = c.replace(oldChips, newChips);
  console.log('Added action prompt chips');
} else {
  console.log('Could not find prompt chips');
}

fs.writeFileSync(FILE, c);
console.log('\nDone. Restart forge-dashboard to apply changes.');
