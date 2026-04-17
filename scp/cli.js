const SCPGenerator = require("./scp_generator");
const SCPValidator = require("./scp_validator");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (command === "generate") {
    const strategy = { type: args[1] || "consecutive_red", target: parseFloat(args[2]) || 2, stop: parseFloat(args[3]) || 1, hold: parseInt(args[4]) || 5 };
    const generator = new SCPGenerator();
    const capsule = generator.generateSCP(strategy, null);
    const outputPath = path.join(process.env.HOME, "cce", "engines", "scp", capsule.manifest.id);
    generator.writeSCP(capsule, outputPath);
  } else if (command === "validate") {
    const capsulePath = args[1];
    if (!capsulePath) { console.log("Usage: node cli.js validate <path>"); return; }
    const validator = new SCPValidator();
    const status = validator.getCapsuleStatus(capsulePath);
    console.log(JSON.stringify(status, null, 2));
  } else if (command === "list") {
    const scpDir = path.join(process.env.HOME, "cce", "engines", "scp");
    if (fs.existsSync(scpDir)) { console.log("SCP Capsules:"); fs.readdirSync(scpDir).forEach(c => console.log("  - " + c)); }
    else { console.log("No SCP capsules found"); }
  } else {
    console.log("Commands: generate, validate, list");
  }
}

main().catch(console.error);
