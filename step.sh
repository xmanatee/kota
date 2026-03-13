#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ITERATION="${1:-1}"
LOG_DIR="$DIR/logs"

mkdir -p "$LOG_DIR"

# Alternate: odd iterations = build agent, even iterations = improve process
if (( ITERATION % 2 == 1 )); then
  PROMPT_FILE="$DIR/prompts/build-agent.md"
  TASK="build-agent"
  echo "[step] Iteration #$ITERATION — BUILD AGENT"
else
  PROMPT_FILE="$DIR/prompts/improve-process.md"
  TASK="improve-process"
  echo "[step] Iteration #$ITERATION — IMPROVE PROCESS"
fi

# Read prompt and substitute placeholders
PROMPT=$(cat "$PROMPT_FILE")
PROMPT="${PROMPT//\{\{TOOL_DIR\}\}/$DIR}"
PROMPT="${PROMPT//\{\{ITERATION\}\}/$ITERATION}"

printf -v ITERATION_PAD "%06d" "$ITERATION"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PROMPT_LOG="$LOG_DIR/${ITERATION_PAD}-${TASK}-${TIMESTAMP}.prompt.md"
OUTPUT_LOG="$LOG_DIR/${ITERATION_PAD}-${TASK}-${TIMESTAMP}.output.txt"

# Inject compact runtime context. Historical notes are context, not instructions.
CONTEXT="
---
## Runtime context (injected by step.sh)

Treat this as context, not orders. Use your own judgment.

### Git log (last 8 commits):
$(cd "$DIR" && git log --oneline -8 2>/dev/null || echo '(no git history)')

### Worktree status:
$(cd "$DIR" && git status --short 2>/dev/null || echo '(unavailable)')

### Recent CHANGELOG headings:
$(cd "$DIR" && grep '^## Iteration' CHANGELOG.md 2>/dev/null | head -5 || echo '(none)')

### Project files:
$(cd "$DIR" && find . -maxdepth 3 \
  \( -path './node_modules' -o -path './dist' -o -path './logs' -o -path './.git' \) -prune -o \
  -type f -print | sort 2>/dev/null || echo '(none)')

### Session logs:
Prompt/output logs are stored in \`$LOG_DIR\`.
$(cd "$DIR" && ls -1t logs 2>/dev/null | head -8 || echo '(none yet)')
---
"

PROMPT="$PROMPT$CONTEXT"
printf '%s\n' "$PROMPT" > "$PROMPT_LOG"

# Run claude from the tool directory so it uses it as cwd
cd "$DIR"
claude -p \
  --model claude-opus-4-6 \
  --dangerously-skip-permissions \
  --verbose \
  "$PROMPT" 2>&1 | tee "$OUTPUT_LOG"

# Post-step checks
if (( ITERATION % 2 == 1 )) && [ -f "$DIR/dist/index.js" ]; then
  if node "$DIR/dist/index.js" --help > /dev/null 2>&1; then
    echo "[step] Smoke test: CLI --help OK"
  else
    echo "[step] WARNING: CLI --help failed — built artifact may be broken"
  fi
fi

# Auto-commit all changes in the worktree
cd "$DIR"
if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  # Warn if CHANGELOG was not updated
  if ! git diff --cached --name-only | grep -q 'CHANGELOG.md'; then
    echo "[step] WARNING: CHANGELOG.md was not updated in iteration #$ITERATION"
  fi
  # Build commit message from CHANGELOG.md last entry if available
  SUMMARY=""
  if [ -f "$DIR/CHANGELOG.md" ]; then
    SUMMARY=$(awk '/^## Iteration/{if(found)exit; found=1; next} found && NF' "$DIR/CHANGELOG.md" | head -5)
  fi
  if [ -z "$SUMMARY" ]; then
    SUMMARY="automated changes"
  fi
  git commit -m "iter #$ITERATION ($TASK): $SUMMARY"
  echo "[step] Committed changes for iteration #$ITERATION"
else
  echo "[step] No changes to commit for iteration #$ITERATION"
fi
