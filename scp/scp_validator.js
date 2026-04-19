const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class SCPValidator {
  validateCapsule(capsulePath) {
    let capsule;
    try {
      const filePath = path.join(capsulePath, "capsule.json");
      if (!fs.existsSync(filePath)) return { valid: false, errors: ["capsule.json not found"] };
      capsule = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
      return { valid: false, errors: ["Invalid JSON format or read error: " + e.message] };
    }

    const errors = [];
    if (!capsule.protocol) errors.push("Missing protocol");
    if (!capsule.manifest) errors.push("Missing manifest");
    if (!capsule.semantic_context) errors.push("Missing semantic_context");
    if (!capsule.lifecycle) errors.push("Missing lifecycle");
    if (!capsule.signature) errors.push("Missing signature");
    
    return { valid: errors.length === 0, errors: errors, capsule: capsule };
  }

  getCapsuleStatus(capsulePath) {
    const validation = this.validateCapsule(capsulePath);
    if (!validation.valid) return { status: "invalid", errors: validation.errors };
    const capsule = validation.capsule;
    const status = (capsule.lifecycle && capsule.lifecycle.status) || (capsule.manifest && capsule.manifest.status) || "unknown";
    return { id: capsule.manifest.id, name: capsule.manifest.name, version: capsule.manifest.version, status: status };
  }
}

module.exports = SCPValidator;
