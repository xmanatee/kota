#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ITERATION="${1:-1}"

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

# Inject pre-flight context so the agent doesn't waste tool calls on orientation
CONTEXT="
---
## Pre-flight context (injected by step.sh)

### Git log (last 10 commits):
$(cd "$DIR" && git log --oneline -10 2>/dev/null || echo '(no git history)')

### Source files:
$(cd "$DIR" && find . -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.md' | grep -v node_modules | grep -v dist | sort 2>/dev/null || echo '(none)')

### Last CHANGELOG entry:
$(cd "$DIR" && awk '/^## Iteration/{if(found)exit; found=1} found' CHANGELOG.md 2>/dev/null || echo '(no changelog)')
---
"

PROMPT="$PROMPT$CONTEXT"

# Run claude from the tool directory so it uses it as cwd
cd "$DIR"
claude -p \
  --model claude-opus-4-6 \
  --dangerously-skip-permissions \
  --verbose \
  "$PROMPT"

# Auto-commit all changes in the worktree
cd "$DIR"
if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
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
