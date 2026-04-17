#!/bin/bash
# Unified status with Aegis compliance

echo "════════════════════════════════════════════════════════"
echo "     KRAKEN INTELLIGENCE - COMPLETE SYSTEM STATUS"
echo "════════════════════════════════════════════════════════"

# Run Aegis compliance report using node directly
echo ""
echo "🔒 COMPLIANCE STATUS:"
node ~/kraken-intelligence/tools/aegis/cli.js report

# Show PM2 status
echo ""
echo "📊 RUNNING PROCESSES:"
pm2 list

# Show active market state
echo ""
echo "📈 CURRENT MARKET:"
if [ -f ~/kraken-intelligence/reasoning-bot/active_strategy.json ]; then
  cat ~/kraken-intelligence/reasoning-bot/active_strategy.json | jq '.marketState'
fi

# Show SCP capsules
echo ""
echo "📦 SCP CAPSULES:"
ls -la ~/cce/engines/scp/ 2>/dev/null | tail -n +2
