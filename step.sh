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
LOG_PREFIX="${ITERATION_PAD}-${TASK}-${TIMESTAMP}"
SESSION_LOG="$LOG_DIR/${LOG_PREFIX}.session.jsonl"

# Run claude
cd "$DIR"
STEP_START=$(date +%s)
CLAUDE_EXIT=0
claude -p \
  --verbose \
  --model claude-opus-4-6 \
  --dangerously-skip-permissions \
  --output-format stream-json \
  "$PROMPT" < /dev/null > "$SESSION_LOG" 2>"$LOG_DIR/${LOG_PREFIX}.stderr.log" || CLAUDE_EXIT=$?
STEP_DURATION=$(( $(date +%s) - STEP_START ))

if (( CLAUDE_EXIT != 0 )); then
  echo "[step] claude exited with status $CLAUDE_EXIT (${STEP_DURATION}s)"
  exit "$CLAUDE_EXIT"
fi

echo "[step] claude finished in ${STEP_DURATION}s"

# Append metrics row (extract cost/turns from session log)
METRICS="$DIR/metrics.csv"
[ -f "$METRICS" ] || echo "iter,task,duration_s,cost_usd,num_turns,output_tokens" > "$METRICS"
METRICS_ROW=$(node -e "
  const lines = require('fs').readFileSync('$SESSION_LOG','utf8').trim().split('\n');
  for (let i=lines.length-1;i>=0;i--) {
    try { const o=JSON.parse(lines[i]); if(o.type==='result') {
      console.log([o.total_cost_usd?.toFixed(4)??'-',o.num_turns??'-',o.usage?.output_tokens??'-'].join(','));
      process.exit();
    }} catch(e){}
  }
  console.log('-,-,-');
" 2>/dev/null || echo "-,-,-")
echo "${ITERATION},${TASK},${STEP_DURATION},${METRICS_ROW}" >> "$METRICS"

# Auto-commit all changes in the worktree
cd "$DIR"
if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  SUMMARY=""
  if [ -f "$DIR/CHANGELOG.md" ]; then
    SUMMARY=$(awk '/^## /{if(found)exit; found=1; next} found && NF{print; exit}' "$DIR/CHANGELOG.md")
  fi
  if [ -z "$SUMMARY" ]; then
    SUMMARY="automated changes"
  fi
  git commit -m "iter #$ITERATION ($TASK): $SUMMARY"
  echo "[step] Committed changes for iteration #$ITERATION"
else
  echo "[step] No changes to commit for iteration #$ITERATION"
fi
