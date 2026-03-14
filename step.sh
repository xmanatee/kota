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

# Generate session summary (readable digest for next iteration's agent)
SUMMARY_FILE="$LOG_DIR/${LOG_PREFIX}.summary.md"
python3 "$DIR/scripts/summarize-session.py" "$SESSION_LOG" "$SUMMARY_FILE" 2>/dev/null || true

# Append metrics row (extract cost/turns from session log)
METRICS="$DIR/metrics.csv"
[ -f "$METRICS" ] || echo "iter,task,duration_s,src_files,src_lines,bundle_bytes,smoke_help,smoke_haiku,test_files,tests_passed,cost_usd,num_turns,output_tokens" > "$METRICS"
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

# Collect project metrics (build-agent iterations only)
SRC_FILES="-"; SRC_LINES="-"; BUNDLE_BYTES="-"
SMOKE_HELP="-"; SMOKE_HAIKU="-"; TEST_FILES="-"; TESTS_PASSED="-"

if [[ "$TASK" == "build-agent" ]]; then
  SRC_FILES=$(find "$DIR/src" -name '*.ts' ! -name '*.test.ts' ! -name '*.d.ts' 2>/dev/null | wc -l | tr -d ' ')
  SRC_LINES=$(find "$DIR/src" -name '*.ts' ! -name '*.test.ts' ! -name '*.d.ts' -exec cat {} + 2>/dev/null | wc -l | tr -d ' ')
  [ -f "$DIR/dist/cli.js" ] && BUNDLE_BYTES=$(wc -c < "$DIR/dist/cli.js" | tr -d ' ')
  TEST_FILES=$(find "$DIR/src" -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')

  # Smoke test: --help
  if node "$DIR/dist/cli.js" --help > /dev/null 2>&1; then
    SMOKE_HELP="PASS"
  else
    SMOKE_HELP="FAIL"
  fi

  # Run tests and count passes (match "Tests  N passed", not "Test Files")
  TEST_OUTPUT=$(cd "$DIR" && npm test 2>&1 || true)
  CLEAN_OUTPUT=$(echo "$TEST_OUTPUT" | sed $'s/\x1b\\[[0-9;]*m//g')
  TESTS_PASSED=$(echo "$CLEAN_OUTPUT" | grep -E '^\s*Tests\s' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "-")
  echo "[step] Metrics: ${SRC_FILES} src files, ${SRC_LINES} lines, ${TESTS_PASSED} tests passed"

  # E2E smoke test: run the agent on a trivial task to verify it works end-to-end
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    SMOKE_E2E_DIR=$(mktemp -d)
    echo "The answer is 42" > "$SMOKE_E2E_DIR/test.txt"
    echo "[step] Running e2e smoke test..."
    SMOKE_AGENT_OUT=$(cd "$SMOKE_E2E_DIR" && timeout 60 node "$DIR/dist/cli.js" run \
      --model claude-haiku-4-5-20251001 \
      --max-tokens 256 \
      --yes \
      "Read the file test.txt in the current directory and tell me what number it mentions" \
      < /dev/null 2>/dev/null) || true
    rm -rf "$SMOKE_E2E_DIR"
    if echo "$SMOKE_AGENT_OUT" | grep -qi "42"; then
      SMOKE_HAIKU="PASS"
      echo "[step] E2E smoke test: PASS"
    else
      SMOKE_HAIKU="FAIL"
      echo "[step] E2E smoke test: FAIL"
      echo "[step] Agent output: $(echo "$SMOKE_AGENT_OUT" | head -5)"
    fi
  else
    echo "[step] E2E smoke test: SKIP (no ANTHROPIC_API_KEY)"
  fi
fi

echo "${ITERATION},${TASK},${STEP_DURATION},${SRC_FILES},${SRC_LINES},${BUNDLE_BYTES},${SMOKE_HELP},${SMOKE_HAIKU},${TEST_FILES},${TESTS_PASSED},${METRICS_ROW}" >> "$METRICS"

# Auto-commit all changes in the worktree
cd "$DIR"
if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  SUMMARY=""
  if [ -f "$DIR/CHANGELOG.md" ]; then
    SUMMARY=$(awk '/^## /{if(found)exit; found=1; next} found && NF' "$DIR/CHANGELOG.md" | head -5)
  fi
  if [ -z "$SUMMARY" ]; then
    SUMMARY="automated changes"
  fi
  git commit -m "iter #$ITERATION ($TASK): $SUMMARY"
  echo "[step] Committed changes for iteration #$ITERATION"
else
  echo "[step] No changes to commit for iteration #$ITERATION"
fi
