#!/bin/bash
# Run every hour to update dry run status

cd ~/kraken-intelligence/dry-run-manager
node cli.js auto

# Also check for ready strategies and send notification
READY=$(node -e "const m = require('./dry_run_manager'); const r = new m().run(); console.log(r.length);")
if [ "$READY" -gt 0 ]; then
  echo "🔔 $READY strategies ready for live deployment!" 
fi
