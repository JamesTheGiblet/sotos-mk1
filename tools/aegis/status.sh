#!/bin/bash
# Unified status with Aegis compliance

# Get the directory of the script itself to make paths relative
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
# Navigate up two levels to the project root (from tools/aegis/ to the root)
PROJECT_ROOT=$(realpath "$SCRIPT_DIR/../..")

echo ""
echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
echo "║                    ADAPTIVE INTELLIGENCE PLATFORM                              ║"
echo "║                         S.O.T.O.S. MK1 STATUS                                  ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════╝"

# Run Aegis compliance report using node directly
# The Aegis report already has its own headers, so we just run it.
node "$PROJECT_ROOT/tools/aegis/cli.js" report

# Show PM2 status
echo ""
echo "📊 RUNNING PROCESSES:"
echo "───────────────────────────────────────────────────────────────────────────────"
pm2 list 2>/dev/null || echo "  PM2 not running or not found."

# Show active market state
echo ""
echo "📈 CURRENT MARKET:"
echo "───────────────────────────────────────────────────────────────────────────────"
MARKET_STATE_FILE="$PROJECT_ROOT/reasoning-bot/active_strategy.json"
if [ -f "$MARKET_STATE_FILE" ]; then
  # Use Node to parse and print the JSON to avoid jq dependency
  node -e "
    const fs = require('fs');
    const path = '$MARKET_STATE_FILE';
    try {
      const data = JSON.parse(fs.readFileSync(path, 'utf8'));
      const ms = data.marketState;
      if (ms) {
        console.log('  Regime:    ', ms.regime);
        console.log('  Phase:     ', ms.phase);
        console.log('  Sentiment: ', ms.sentiment);
        console.log('  BTC Price: $', (ms.btcPrice || 0).toLocaleString());
      }
    } catch(e) {}
  "
fi

# Show SCP capsules
echo ""
echo "📦 SCP CAPSULES (Last 5):"
echo "───────────────────────────────────────────────────────────────────────────────"
ls -lt "$HOME/cce/engines/scp" 2>/dev/null | grep '^d' | head -n 5 | awk '{print "  " $9}'
