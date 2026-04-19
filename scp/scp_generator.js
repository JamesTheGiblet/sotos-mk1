const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class SCPGenerator {
  constructor() { this.version = "1.0.0"; }

  generateHash(content) {
    return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
  }

  createManifest(strategy, validationResult) {
    const now = new Date().toISOString();
    const manifest = {
      id: strategy.type + "-" + now.slice(0,10) + "-" + Math.random().toString(36).slice(2,6),
      name: strategy.type.toUpperCase() + " Strategy",
      version: "1.0.0",
      semanticVersion: { major: 1, minor: 0, patch: 0 },
      created: now,
      type: strategy.type,
      timeframe: "1D",
      symbol: "BTC/USD",
      exchange: "kraken",
      capital: strategy.capital || 1000,
      status: validationResult && validationResult.passed ? "validated" : "hypothesis",
      capabilities: ["long"],
      parameters: { targetPct: strategy.target, stopPct: strategy.stop, maxHoldDays: strategy.hold },
      marketFit: { bestRegime: strategy.bestRegime || "RANGING" }
    };
    manifest.hash = this.generateHash(manifest);
    return manifest;
  }

  createSemanticContext(strategy) {
    return {
      regime: strategy.bestRegime || "RANGING",
      entry_rules: [strategy.type.replace(/_/g, ' ')],
      exit_rules: [],
      risk_management: {
        take_profit: "+" + strategy.target + "%",
        stop_loss: "-" + strategy.stop + "%",
        max_hold_days: strategy.hold
      }
    };
  }

  generateSCP(strategy, validationResult) {
    const manifest = this.createManifest(strategy, validationResult);
    const semanticContext = this.createSemanticContext(strategy);
    const capsule = {
      protocol: { name: "Semantic Capsule Protocol", version: "1.0.0" },
      manifest: manifest,
      semantic_context: semanticContext,
      lifecycle: { status: manifest.status, last_updated: new Date().toISOString() },
      signature: { hash: this.generateHash({ manifest: manifest, semantic_context: semanticContext }), timestamp: new Date().toISOString() }
    };
    return capsule;
  }

  writeSCP(capsule, outputPath) {
    if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, "capsule.json"), JSON.stringify(capsule, null, 2));
    return capsule;
  }
}

module.exports = SCPGenerator;
