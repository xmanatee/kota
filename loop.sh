#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ITERATION=0

# On Ctrl-C: the foreground step.sh will receive the signal and exit,
# then loop continues here and we exit cleanly
trap 'echo ""; echo "[loop] Stopped at iteration #$ITERATION"; exit 0' INT TERM

while true; do
  ITERATION=$((ITERATION + 1))
  echo "=========================================="
  echo "  Iteration #$ITERATION — $(date)"
  echo "=========================================="

  # Run step in foreground; trap will forward INT to the child
  "$DIR/step.sh" "$ITERATION" || true

  echo ""
  echo "Step completed. Starting next iteration..."
  echo ""
done
