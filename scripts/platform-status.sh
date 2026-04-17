#!/bin/bash
# Adaptive Intelligence Platform — Status Script

echo ""
echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
echo "║                    ADAPTIVE INTELLIGENCE PLATFORM                              ║"
echo "║                         Kraken Intelligence                                    ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════╝"
echo ""

echo "📊 SYSTEM STATUS:"
echo "───────────────────────────────────────────────────────────────────────────────"
pm2 list 2>/dev/null || echo "  PM2 not running"

echo ""
echo "📈 MARKET STATE:"
echo "───────────────────────────────────────────────────────────────────────────────"
if [ -f ~/kraken-intelligence/reasoning-bot/active_strategy.json ]; then
  cat ~/kraken-intelligence/reasoning-bot/active_strategy.json | jq -r '.marketState'
else
  echo "  No market data"
fi

echo ""
echo "📦 SCP CAPSULES:"
echo "───────────────────────────────────────────────────────────────────────────────"
if [ -d ~/cce/engines/scp ]; then
  ls -la ~/cce/engines/scp/ 2>/dev/null | tail -n +2 || echo "  No capsules"
else
  echo "  No capsules directory"
fi

echo ""
echo "🔧 PLATFORM TOOLS:"
echo "───────────────────────────────────────────────────────────────────────────────"
echo "  ✅ Kraken Intelligence  | Trading System"
echo "  ✅ Whisper              | Security Scanner"
echo "  ✅ Aegis                | Compliance Framework"
echo "  ✅ EmbedID              | Code Watermarking"
echo "  ✅ MarkFlow             | Markdown Editor"
echo "  🚧 Test Generator       | In Development"
echo "  🚧 CertiScope           | In Development"
echo "  🚧 TreeCraft            | In Development"
echo "  🚧 Chameleon LM         | In Development"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  Part of the Adaptive Intelligence Platform — MIT License"
echo "═══════════════════════════════════════════════════════════════════════════════"

echo ""
echo "📜 PLATFORM PHILOSOPHY:"
echo "───────────────────────────────────────────────────────────────────────────────"
echo "  Cost Control → No cloud dependencies, runs on your hardware"
echo "  Security     → Three locks, API keys in .env, 30-day dry runs"
echo "  Quality      → Forward testing, auto-optimization, Monte Carlo"
echo "  Efficiency   → Autonomous operation, market-adaptive switching"
echo "  Freedom      → MIT License, no vendor lock-in, SCP portability"
