#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$DIR/.loop-state"
ITERATION=0
LAST_STARTED=0
LAST_COMPLETED=0

detect_last_completed() {
  local last
  last="$(cd "$DIR" && git log --oneline --grep '^iter #' -20 2>/dev/null \
    | sed -nE 's/^[0-9a-f]+ iter #([0-9]+).*/\1/p' | head -1)"
  if [[ "$last" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$last"
  else
    printf '0\n'
  fi
}

write_state() {
  printf 'last_started=%s\nlast_completed=%s\n' "$1" "$2" > "$STATE_FILE"
}

load_state() {
  LAST_STARTED=0
  LAST_COMPLETED="$(detect_last_completed)"

  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
    if [[ "${last_started:-}" =~ ^[0-9]+$ ]]; then
      LAST_STARTED="$last_started"
    fi
    if [[ "${last_completed:-}" =~ ^[0-9]+$ ]]; then
      LAST_COMPLETED="$last_completed"
    fi
  fi
}

# On Ctrl-C: the foreground step.sh will receive the signal and exit,
# state is already on disk, so the next launch can resume the same iteration.
trap 'echo ""; echo "[loop] Stopped at iteration #$ITERATION"; exit 0' INT TERM

load_state

if [ -n "${1:-}" ]; then
  ITERATION="$1"
  echo "[loop] Starting from explicit iteration #$ITERATION"
elif (( LAST_STARTED > LAST_COMPLETED )); then
  ITERATION="$LAST_STARTED"
  echo "[loop] Resuming interrupted iteration #$ITERATION"
else
  ITERATION=$((LAST_COMPLETED + 1))
  echo "[loop] Starting at iteration #$ITERATION"
fi

while true; do
  write_state "$ITERATION" "$LAST_COMPLETED"
  echo "=========================================="
  echo "  Iteration #$ITERATION — $(date)"
  echo "=========================================="

  if "$DIR/step.sh" "$ITERATION"; then
    LAST_COMPLETED="$ITERATION"
    write_state "$ITERATION" "$LAST_COMPLETED"
  else
    STEP_STATUS=$?
    write_state "$ITERATION" "$LAST_COMPLETED"
    echo "[loop] Iteration #$ITERATION exited with status $STEP_STATUS"
    echo "[loop] Fix the issue and restart; the next launch will resume iteration #$ITERATION"
    exit "$STEP_STATUS"
  fi

  echo ""
  echo "Step completed. Starting next iteration..."
  echo ""
  ITERATION=$((ITERATION + 1))
done
