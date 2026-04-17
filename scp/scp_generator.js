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
      status: validationResult && validationResult.passed ? "validated" : "generated",
      capabilities: ["long"],
      parameters: { targetPct: strategy.target, stopPct: strategy.stop, maxHoldDays: strategy.hold },
      marketFit: { bestRegime: strategy.bestRegime || "RANGING" }
    };
    manifest.hash = this.generateHash(manifest);
    return manifest;
  }

  createStrategyModule(strategy) {
    return {
      name: strategy.type.toUpperCase() + " Strategy",
      version: "1.0.0",
      validate: true,
      entryRules: { type: strategy.type },
      exitRules: { targetPct: strategy.target, stopPct: strategy.stop, maxHoldDays: strategy.hold },
      entryTiming: "next_open",
      params: { targetPct: strategy.target, stopPct: strategy.stop, maxHoldDays: strategy.hold }
    };
  }

  generateSCP(strategy, validationResult) {
    const manifest = this.createManifest(strategy, validationResult);
    const strategyModule = this.createStrategyModule(strategy);
    const capsule = {
      protocol: { name: "Semantic Capsule Protocol", version: "1.0.0" },
      manifest: manifest,
      strategy: strategyModule,
      storage: { engineId: manifest.id, version: "1.0.0" },
      engine: { id: manifest.id, parameters: manifest.parameters },
      signature: { hash: this.generateHash({ manifest: manifest, strategy: strategyModule }), timestamp: new Date().toISOString() }
    };
    return capsule;
  }

  writeSCP(capsule, outputPath) {
    if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, "capsule.json"), JSON.stringify(capsule, null, 2));
    console.log("SCP written to " + outputPath);
    return capsule;
  }
}

module.exports = SCPGenerator;
