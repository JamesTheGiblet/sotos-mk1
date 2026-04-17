#!/bin/bash
echo "=== DRY RUN SUMMARY $(date) ==="
echo ""
echo "Four Red Days:"
grep -E "(ENTER|EXIT|Final capital)" ~/cce/engines/four-red-days/dryrun.log | tail -5
echo ""
echo "Stats:"
node -e "console.log(require('./dryrun/stats.js')())"
