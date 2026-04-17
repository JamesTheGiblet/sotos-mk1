#!/usr/bin/env node
const EmbedID = require('./index');
const embedid = new EmbedID();
const args = process.argv.slice(2);
const command = args[0];

if (command === 'watermark') {
  const capsulePath = args[1];
  const strategyId = args[2];
  
  if (!capsulePath || !strategyId) {
    console.log('Usage: node cli.js watermark <capsule-path> <strategy-id>');
    process.exit(1);
  }
  
  const result = embedid.watermarkSCPCapsule(capsulePath, strategyId);
  if (result.success) {
    console.log(`✅ Watermarked capsule: ${result.fingerprint.fingerprint}`);
    console.log(`   Strategy: ${result.fingerprint.strategyId}`);
  } else {
    console.log(`❌ Failed: ${result.error}`);
  }
  
} else if (command === 'verify') {
  const codeFile = args[1];
  if (!codeFile) {
    console.log('Usage: node cli.js verify <code-file>');
    process.exit(1);
  }
  
  const code = require('fs').readFileSync(codeFile, 'utf8');
  const result = embedid.verifyWatermark(code);
  
  if (result.valid) {
    console.log(`✅ Watermark valid`);
    console.log(`   Fingerprint: ${result.extracted.fingerprint}`);
    console.log(`   Strategy: ${result.extracted.strategyId}`);
  } else {
    console.log(`❌ Watermark invalid: ${result.reason}`);
  }
  
} else {
  console.log(`
EmbedID — Code Watermarking & Provenance Tracking

Commands:
  node cli.js watermark <capsule-path> <strategy-id>  Add watermark to SCP capsule
  node cli.js verify <code-file>                      Verify watermark in code

Examples:
  node cli.js watermark ~/cce/engines/scp/consecutive_red-2026-04-15-xf18 consecutive_red
  node cli.js verify engine.js
`);
}
