#!/usr/bin/env node
/**
 * forge-auto.js
 * Runs the Forge loop until a new strategy passes or max iterations reached.
 *
 * Usage:
 *   node forge-auto.js           (default 5 iterations)
 *   node forge-auto.js 10        (custom iterations)
 */

const { execSync } = require('child_process');
const path = require('path');

const BASE = path.join(process.env.HOME, 'kraken-intelligence');

function run(cmd) {
  try {
    return execSync(`cd ${BASE} && ${cmd}`, { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    return e.stdout || e.message;
  }
}

function didPass(output) {
  return output.includes('✅ PASSED');
}

function didFail(output) {
  return output.includes('❌ FAILED');
}

async function autoLoop(maxIterations = 5) {
  console.log(`🔄 FORGE AUTO LOOP — Max ${maxIterations} iterations`);
  console.log('='.repeat(60));

  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n🔥 ITERATION ${i}/${maxIterations}`);
    console.log('-'.repeat(40));

    // Generate new hypothesis
    console.log('🧠 Reasoning...');
    const reasonOut = run('node forge-reasoning.js');
    const nameLine  = reasonOut.match(/Name:\s+(.+)/);
    const idLine    = reasonOut.match(/ID:\s+(.+)/);
    if (nameLine) console.log(`   → ${nameLine[1].trim()}`);

    // Validate it
    console.log('⚖️  Validating...');
    const validOut  = run('node forge-validator.js');
    const resultLine = validOut.match(/📈.+/);
    if (resultLine) console.log(`   ${resultLine[0].trim()}`);

    if (didPass(validOut)) {
      const poolLine = validOut.match(/✅ Added.+/);
      if (poolLine) console.log(`   ${poolLine[0].trim()}`);
      console.log(`\n🎉 SUCCESS on iteration ${i}.`);
      console.log('='.repeat(60));
      return true;
    }

    if (didFail(validOut)) {
      const failLine = validOut.match(/❌ FAILED.+/);
      if (failLine) console.log(`   ${failLine[0].trim()}`);
      console.log('   📝 Failure recorded. Adjusting next hypothesis...');
    }

    // Delete the failed capsule so next iteration generates a fresh one
    if (idLine) {
      const id = idLine[1].trim();
      run(`rm -rf ${path.join(process.env.HOME, 'cce/engines/scp', id)}`);
    } else {
      // Fallback: delete all hypothesis capsules
      run(`node -e "
        const fs = require('fs');
        const p = '${path.join(process.env.HOME, 'cce/engines/scp')}';
        fs.readdirSync(p).forEach(d => {
          const cf = p + '/' + d + '/capsule.json';
          if (fs.existsSync(cf)) {
            const c = JSON.parse(fs.readFileSync(cf, 'utf8'));
            if (c.manifest?.status === 'failed_validation' || c.lifecycle?.status === 'failed_validation') {
              fs.rmSync(p + '/' + d, { recursive: true });
            }
          }
        });
      "`);
    }
  }

  console.log(`\n⚠️  Reached ${maxIterations} iterations without a new passing strategy.`);
  console.log('='.repeat(60));
  return false;
}

const iterations = parseInt(process.argv[2]) || 5;
autoLoop(iterations).catch(console.error);
