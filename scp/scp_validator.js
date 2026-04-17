const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class SCPValidator {
  validateCapsule(capsulePath) {
    const capsule = JSON.parse(fs.readFileSync(path.join(capsulePath, "capsule.json"), "utf8"));
    const errors = [];
    if (!capsule.protocol) errors.push("Missing protocol");
    if (!capsule.manifest) errors.push("Missing manifest");
    if (!capsule.strategy) errors.push("Missing strategy");
    return { valid: errors.length === 0, errors: errors, capsule: capsule };
  }

  getCapsuleStatus(capsulePath) {
    const validation = this.validateCapsule(capsulePath);
    if (!validation.valid) return { status: "invalid", errors: validation.errors };
    const capsule = validation.capsule;
    return { id: capsule.manifest.id, name: capsule.manifest.name, version: capsule.manifest.version, status: capsule.manifest.status };
  }
}

module.exports = SCPValidator;
