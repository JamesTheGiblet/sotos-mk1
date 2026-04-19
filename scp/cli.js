#!/usr/bin/env node
const SCPGenerator = require("./scp_generator");
const SCPValidator = require("./scp_validator");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const command = args[0];
const HOME = process.env.HOME || process.env.USERPROFILE;

async function main() {
  if (command === "generate") {
    const strategy = { type: args[1] || "consecutive_red", target: parseFloat(args[2]) || 2, stop: parseFloat(args[3]) || 1, hold: parseInt(args[4]) || 5 };
    console.log('\n   ⚙️  Generating SCP capsule...');
    const generator = new SCPGenerator();
    const capsule = generator.generateSCP(strategy, null);
    const outputPath = path.join(HOME, "cce", "engines", "scp", capsule.manifest.id);
    generator.writeSCP(capsule, outputPath);
    console.log(`      Strategy: ${strategy.type}`);
    console.log(`      ID:       ${capsule.manifest.id}`);
    console.log(`   ✅ Saved to: ${outputPath}\n`);
    
  } else if (command === "validate") {
    const capsulePath = args[1];
    if (!capsulePath) { console.log("   ⚠️  Usage: node cli.js validate <path>"); return; }
    
    console.log('\n   🔍 Validating SCP capsule...');
    const validator = new SCPValidator();
    const status = validator.getCapsuleStatus(capsulePath);
    const formatted = JSON.stringify(status, null, 2).split('\n').map(l => '      ' + l).join('\n');
    console.log(formatted + '\n');
    
  } else if (command === "list") {
    const scpDir = path.join(HOME, "cce", "engines", "scp");
    console.log('\n' + '═'.repeat(60));
    console.log('📦 SCP CAPSULES');
    console.log('═'.repeat(60));
    
    if (fs.existsSync(scpDir)) { 
      const capsules = fs.readdirSync(scpDir).filter(c => !c.startsWith('.'));
      if (capsules.length === 0) console.log("   No capsules found.");
      else capsules.forEach(c => console.log("   - " + c)); 
    } else { 
      console.log("   ❌ SCP directory not found: " + scpDir); 
    }
    console.log('\n');
    
  } else {
    console.log('\n' + '═'.repeat(60));
    console.log('💊 SCP — Semantic Capsule Protocol');
    console.log('═'.repeat(60));
    console.log('   Commands:');
    console.log('     node cli.js generate <type> <target> <stop> <hold>   Create capsule');
    console.log('     node cli.js validate <path>                          Validate capsule');
    console.log('     node cli.js list                                     List all capsules');
    console.log('\n   Examples:');
    console.log('     node cli.js generate consecutive_red 2 1 5');
    console.log('     node cli.js validate ~/cce/engines/scp/hyp_abc_123');
    console.log('     node cli.js list\n');
  }
}

main().catch(console.error);
