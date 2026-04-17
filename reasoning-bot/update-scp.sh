#!/bin/bash
# Manual SCP update trigger

cd ~/kraken-intelligence
node -e "require('./scp-auto-updater.js'); const u = new (require('./scp-auto-updater'))(); const data = u.generateSCP(); u.saveSCP(data); console.log('✅ SCP manually updated');"
