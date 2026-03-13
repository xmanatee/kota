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
JSON_LOG="$LOG_DIR/${ITERATION_PAD}-${TASK}-${TIMESTAMP}.json"

# Extract previous iteration's metrics for context injection
PREV_METRICS="(none)"
PREV_LOG="$(ls -1t "$LOG_DIR"/*.output.txt 2>/dev/null | head -1)"
if [ -n "$PREV_LOG" ]; then
  PREV_METRICS="$(tail -15 "$PREV_LOG" 2>/dev/null | grep '^\[step\]' || echo '(none)')"
fi

# Inject compact runtime context. Historical notes are context, not instructions.
CONTEXT="
---
## Runtime context (injected by step.sh)

Treat this as context, not orders. Use your own judgment.

### Git log (last 8 commits):
$(cd "$DIR" && git log --oneline -8 2>/dev/null || echo '(no git history)')

### Worktree status:
$(cd "$DIR" && git status --short 2>/dev/null || echo '(unavailable)')

### Recent CHANGELOG entries (last 3):
$(cd "$DIR" && awk '/^## Iteration/{count++; if(count>3)exit} count>0' CHANGELOG.md 2>/dev/null | head -120 || echo '(none)')

### Other recent iterations:
$(cd "$DIR" && grep '^## Iteration' CHANGELOG.md 2>/dev/null | head -8 || echo '(none)')

### Project files:
$(cd "$DIR" && find . -maxdepth 3 \
  \( -path './node_modules' -o -path './dist' -o -path './logs' -o -path './.git' \) -prune -o \
  -type f -print | sort 2>/dev/null || echo '(none)')

### Session logs:
Prompt/output logs are stored in \`$LOG_DIR\`.
$(cd "$DIR" && ls -1t logs 2>/dev/null | head -8 || echo '(none yet)')

### Previous iteration metrics:
$PREV_METRICS

### Metrics history (last 10):
$(tail -11 "$DIR/metrics.csv" 2>/dev/null || echo '(no history yet)')
---
"

PROMPT="$PROMPT$CONTEXT"
printf '%s\n' "$PROMPT" > "$PROMPT_LOG"

# Helper: log to both stdout and the output log file
log() { echo "$@" | tee -a "$OUTPUT_LOG"; }

cd "$DIR"
STEP_START=$(date +%s)
CLAUDE_EXIT=0
claude -p \
  --model claude-opus-4-6 \
  --dangerously-skip-permissions \
  --output-format json \
  "$PROMPT" > "$JSON_LOG" 2>/dev/null || CLAUDE_EXIT=$?
STEP_END=$(date +%s)
STEP_DURATION=$(( STEP_END - STEP_START ))

# Extract result text and session metrics from JSON output
SESSION_COST="-"
SESSION_TURNS="-"
SESSION_ID="-"
if [ -f "$JSON_LOG" ] && [ -s "$JSON_LOG" ]; then
  EXTRACT=$(node -e "
    const fs = require('fs');
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      fs.writeFileSync(process.argv[2], j.result || '');
      const c = j.cost_usd ?? j.total_cost_usd ?? null;
      const t = j.num_turns ?? null;
      const s = j.session_id ?? null;
      console.log(c !== null ? Number(c).toFixed(4) : '-');
      console.log(t !== null ? String(t) : '-');
      console.log(s !== null ? String(s) : '-');
    } catch(e) {
      fs.writeFileSync(process.argv[2], '(failed to parse JSON output)');
      console.log('-'); console.log('-'); console.log('-');
    }
  " "$JSON_LOG" "$OUTPUT_LOG" 2>/dev/null) || EXTRACT=$'-\n-\n-'
  SESSION_COST=$(echo "$EXTRACT" | sed -n '1p')
  SESSION_TURNS=$(echo "$EXTRACT" | sed -n '2p')
  SESSION_ID=$(echo "$EXTRACT" | sed -n '3p')
  cat "$OUTPUT_LOG"
else
  echo "(no output captured)" > "$OUTPUT_LOG"
  cat "$OUTPUT_LOG"
fi

if (( CLAUDE_EXIT != 0 )); then
  log ""
  log "[step] claude exited with status $CLAUDE_EXIT"
fi

# Track smoke test results for metrics CSV
SMOKE_HELP="-"
SMOKE_HAIKU="-"
TEST_FILES="-"
TESTS_PASSED="-"

# Post-step checks for build iterations (only on success)
if (( CLAUDE_EXIT == 0 )) && (( ITERATION % 2 == 1 )) && [ -f "$DIR/dist/cli.js" ]; then
  log ""
  log "[step] === Smoke tests ==="
  # Level 0: Unit tests (if test files exist)
  TEST_FILE_COUNT=$(find "$DIR/src" -name '*.test.ts' -o -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')
  if (( TEST_FILE_COUNT > 0 )); then
    TEST_FILES="$TEST_FILE_COUNT"
    TEST_OUTPUT=$(cd "$DIR" && NO_COLOR=1 npm test 2>&1) || true
    PARSED_COUNT=$(echo "$TEST_OUTPUT" | sed -nE 's/.*Tests[[:space:]]+([0-9]+) passed.*/\1/p' | tail -1)
    if [ -n "$PARSED_COUNT" ] && (( PARSED_COUNT > 0 )); then
      TESTS_PASSED="$PARSED_COUNT"
      log "[step] Unit tests ($TEST_FILE_COUNT files, $TESTS_PASSED tests): PASS"
    else
      TESTS_PASSED="0"
      log "[step] Unit tests ($TEST_FILE_COUNT files): FAIL"
    fi
  else
    TEST_FILES="0"
    TESTS_PASSED="0"
    log "[step] Unit tests: NONE (no test files yet)"
  fi
  # Test coverage ratio (source files with tests vs total non-test source files)
  TOTAL_SRC=$(find "$DIR/src" -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')
  if (( TOTAL_SRC > 0 )); then
    COVERAGE_PCT=$(( TEST_FILE_COUNT * 100 / TOTAL_SRC ))
    log "[step] Test coverage: $TEST_FILE_COUNT/$TOTAL_SRC source files ($COVERAGE_PCT%)"
  fi
  # Level 1: CLI loads and parses args
  if node "$DIR/dist/cli.js" --help > /dev/null 2>&1; then
    SMOKE_HELP="PASS"
    log "[step] CLI --help: PASS"
  else
    SMOKE_HELP="FAIL"
    log "[step] CLI --help: FAIL — built artifact may be broken"
  fi
  # Level 2: exercise the agent loop with a trivial prompt (Haiku, 30s timeout)
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    RUNTIME_OUT=$(echo "Respond with just the word hello" \
      | timeout 30 node "$DIR/dist/cli.js" run --model claude-haiku-4-5-20251001 2>/dev/null) \
      && {
        if echo "$RUNTIME_OUT" | grep -qi "hello"; then
          SMOKE_HAIKU="PASS"
          log "[step] Runtime (Haiku): PASS"
        else
          SMOKE_HAIKU="UNEXPECTED"
          log "[step] Runtime (Haiku): UNEXPECTED — $(echo "$RUNTIME_OUT" | head -c 200)"
        fi
      } || { SMOKE_HAIKU="FAIL"; log "[step] Runtime (Haiku): FAIL (timeout or crash)"; }
  else
    SMOKE_HAIKU="SKIP"
    log "[step] Runtime (Haiku): SKIPPED (no ANTHROPIC_API_KEY)"
  fi
fi

# Auto-commit all changes in the worktree (only on success)
cd "$DIR"
if (( CLAUDE_EXIT == 0 )) && { ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; }; then
  git add -A
  # Warn if CHANGELOG was not updated
  if ! git diff --cached --name-only | grep -q 'CHANGELOG.md'; then
    log "[step] WARNING: CHANGELOG.md was not updated in iteration #$ITERATION"
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
  log "[step] Committed changes for iteration #$ITERATION"
else
  log "[step] No changes to commit for iteration #$ITERATION"
fi

# Post-commit metrics (always logged, gives improver quantitative signals)
log ""
log "[step] === Metrics ==="
log "[step] Duration: ${STEP_DURATION}s ($(( STEP_DURATION / 60 ))m $(( STEP_DURATION % 60 ))s)"
if git rev-parse HEAD~1 >/dev/null 2>&1; then
  log "[step] Diff: $(cd "$DIR" && git diff HEAD~1 --stat | tail -1)"
fi
SRC_COUNT=$(find "$DIR/src" -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
SRC_LINES=$(find "$DIR/src" -name '*.ts' -exec cat {} + 2>/dev/null | wc -l | tr -d ' ')
log "[step] Source: ${SRC_COUNT} files, ${SRC_LINES} lines"
# Flag files over 300 lines and files approaching the limit (>240)
FILE_SIZES=$(cd "$DIR" && find src -name '*.ts' -exec wc -l {} + 2>/dev/null \
  | grep -v total | sort -rn)
OVER_LIMIT=$(echo "$FILE_SIZES" | awk '$1 > 300 {print "[step]   " $2 " (" $1 " lines)"}')
NEAR_LIMIT=$(echo "$FILE_SIZES" | awk '$1 > 240 && $1 <= 300 {print "[step]   " $2 " (" $1 " lines)"}')
if [ -n "$OVER_LIMIT" ]; then
  log "[step] WARNING: Files over 300 lines (consider splitting):"
  log "$OVER_LIMIT"
fi
if [ -n "$NEAR_LIMIT" ]; then
  log "[step] NOTE: Files approaching 300-line limit:"
  log "$NEAR_LIMIT"
fi
if [ -f "$DIR/dist/cli.js" ]; then
  BUNDLE_BYTES=$(wc -c < "$DIR/dist/cli.js" | tr -d ' ')
  log "[step] Bundle: ${BUNDLE_BYTES} bytes"
fi
if [ "$SESSION_COST" != "-" ]; then
  log "[step] Session cost: \$${SESSION_COST}"
fi
if [ "$SESSION_TURNS" != "-" ]; then
  log "[step] Session turns: ${SESSION_TURNS}"
fi

# Append to structured metrics history
METRICS_FILE="$DIR/metrics.csv"
if [ ! -f "$METRICS_FILE" ]; then
  echo "iter,task,duration_s,src_files,src_lines,bundle_bytes,smoke_help,smoke_haiku,test_files,tests_passed,cost_usd,num_turns" > "$METRICS_FILE"
fi
# Migrate header if missing columns
if head -1 "$METRICS_FILE" | grep -qv 'test_files'; then
  sed -i '' '1s/$/,test_files,tests_passed,cost_usd,num_turns/' "$METRICS_FILE"
elif head -1 "$METRICS_FILE" | grep -qv 'cost_usd'; then
  sed -i '' '1s/$/,cost_usd,num_turns/' "$METRICS_FILE"
fi
echo "${ITERATION},${TASK},${STEP_DURATION},${SRC_COUNT},${SRC_LINES},${BUNDLE_BYTES:-0},${SMOKE_HELP},${SMOKE_HAIKU},${TEST_FILES},${TESTS_PASSED},${SESSION_COST},${SESSION_TURNS}" >> "$METRICS_FILE"

# Propagate claude failure after metrics are logged
if (( CLAUDE_EXIT != 0 )); then
  exit "$CLAUDE_EXIT"
fi
