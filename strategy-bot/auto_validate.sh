#!/bin/bash
# Auto-validate newly generated strategies

GENERATED_DIR=~/cce/engines/generated
VALIDATION_DIR=~/kraken-intelligence/validation-pipeline

for strategy in "$GENERATED_DIR"/*/; do
  if [ -f "$strategy/manifest.json" ]; then
    NAME=$(basename "$strategy")
    VALIDATION_FILE="$strategy/validation_result.json"
    
    if [ ! -f "$VALIDATION_FILE" ]; then
      echo "🔬 Validating: $NAME"
      cd "$VALIDATION_DIR"
      node cli.js test consecutive_red 2 1 5 > "$VALIDATION_FILE" 2>&1
      
      if grep -q "VALIDATION PASSED" "$VALIDATION_FILE"; then
        echo "✅ $NAME passed validation"
        # Add to dry run
        cd ~/kraken-intelligence/dry-run-manager
        node cli.js add "$NAME" "$strategy" 2>/dev/null
      else
        echo "❌ $NAME failed validation - marked as UNDER_REVIEW"
        echo "UNDER_REVIEW" > "$strategy/STATUS.txt"
      fi
    fi
  fi
done
