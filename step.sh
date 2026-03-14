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

# Generate and inject context so agents don't waste tool calls on orientation
generate_context() {
  echo "### Recent git history"
  git -C "$DIR" log --oneline -5 2>/dev/null || echo "(no git history)"
  echo ""
  [ -f "$DIR/NOTES.md" ] && { echo "### Project owner notes (NOTES.md)"; cat "$DIR/NOTES.md"; echo ""; }
  echo "### Recent work history (what each iteration did)"
  grep '^## Iteration' "$DIR/CHANGELOG.md" 2>/dev/null | head -6 | while IFS= read -r line; do
    echo "  $line"
  done
  echo ""
  echo "### Last 3 CHANGELOG entries"
  awk '/^## /{c++;if(c>3)exit}c>=1' "$DIR/CHANGELOG.md" 2>/dev/null | head -120
  echo ""
  [ -f "$DIR/AUDIT.md" ] && { echo "### Open issues (AUDIT.md)"; cat "$DIR/AUDIT.md"; echo ""; }
  if [[ "$1" == "build-agent" ]]; then
    [ -f "$DIR/DESIGN.md" ] && { echo "### Architecture (DESIGN.md)"; cat "$DIR/DESIGN.md"; echo ""; }
    echo "### Source tree (file: lines | last-changed | exports | imports | test coverage)"
    echo "Use this to understand module APIs and dependencies without reading files."
    find "$DIR/src" -name '*.ts' ! -name '*.test.ts' ! -name '*.d.ts' 2>/dev/null | sort | while IFS= read -r f; do
      lines=$(wc -l < "$f" | tr -d ' ')
      rel=${f#$DIR/}
      last_iter=$(git -C "$DIR" log --format='%s' -5 -- "$f" 2>/dev/null | grep -oE 'iter #[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "?")
      exports=$(grep -oE '^export (default )?(async )?(class|function|const|type|interface|enum) \w+' "$f" 2>/dev/null | \
        sed -E 's/^export (default )?(async )?(class|function|const|type|interface|enum) //' | \
        head -5 | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
      [ -z "$exports" ] && exports="-"
      imports=$(grep -oE "from ['\"]\.\.?/?[^'\"]+['\"]" "$f" 2>/dev/null | \
        sed -E "s/from ['\"]//;s/['\"]$//;s/\.js$//" | \
        sed -E 's|.*/||' | sort -u | head -4 | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
      if [ -n "$imports" ]; then dep_str=" ← $imports"; else dep_str=""; fi
      test_f="${f%.ts}.test.ts"
      if [ -f "$test_f" ]; then
        tc=$(grep -cE '\b(it|test)\(' "$test_f" 2>/dev/null || echo "0")
        printf "  %s (%s) [iter %s] [%s]%s — %s tests\n" "$rel" "$lines" "$last_iter" "$exports" "$dep_str" "$tc"
      else
        printf "  %s (%s) [iter %s] [%s]%s — no tests\n" "$rel" "$lines" "$last_iter" "$exports" "$dep_str"
      fi
    done
    echo ""
    echo "### Growth trend (last 4 builder iterations)"
    grep "build-agent" "$DIR/metrics.csv" 2>/dev/null | tail -4 | \
      awk -F, '{sl=$5+0;t=$10+0;if(NR>1){printf "  iter %s: src=%s(%+d) tests=%s(%+d) cost=$%s turns=%s orient=%s%%\n",$1,$5,sl-pl,$10,t-pt,$11,$12,$14}else{printf "  iter %s: src=%s tests=%s cost=$%s turns=%s orient=%s%%\n",$1,$5,$10,$11,$12,$14}pl=sl;pt=t}'
    echo ""
    echo "### Budget check (last builder iteration)"
    grep "build-agent" "$DIR/metrics.csv" 2>/dev/null | tail -1 | \
      awk -F, '{
        cost=$11+0; turns=$12+0; orient=$14+0; ew=$15+0
        printf "  Cost: $%.2f %s (target: ≤$1.50)\n", cost, (cost>1.5?"— OVER":"— OK")
        printf "  Turns: %d %s (target: ≤25)\n", turns, (turns>25?"— OVER":"— OK")
        printf "  Orient: %.0f%% %s (target: ≤40%%)\n", orient, (orient>40?"— OVER":"— OK")
        if(ew>0) printf "  Edit/Write calls: %d %s (target: ≤10)\n", ew, (ew>10?"— OVER":"— OK")
        printf "  Orientation calls (Read+Grep) before 1st edit: check summary (target: ≤5)\n"
      }'
    echo ""
  elif [[ "$1" == "improve-process" ]]; then
    local f; f=$(ls -t "$LOG_DIR"/*build-agent*.summary.md 2>/dev/null | head -1)
    [ -n "$f" ] && { echo "### Latest builder session summary"; head -80 "$f"; echo ""; }
    f=$(ls -t "$LOG_DIR"/*improve-process*.summary.md 2>/dev/null | head -1)
    [ -n "$f" ] && { echo "### Latest improver session summary"; head -80 "$f"; echo ""; }
    echo "### Previous CHANGELOG entry (for verification)"
    awk '/^## /{c++;if(c==3){exit}if(c==2){p=1}}p' "$DIR/CHANGELOG.md" 2>/dev/null | head -40
    echo ""
    echo "### Recent metrics"; head -1 "$DIR/metrics.csv"; tail -8 "$DIR/metrics.csv"; echo ""
    echo "### Process health (auto-computed trends)"
    awk -F, '
      /build-agent/ { bc[++bn]=$11; bo[bn]=$14; bt[bn]=$10; be[bn]=$15 }
      /improve-process/ { ic[++iq]=$11 }
      END {
        n=bn<4?bn:4; s=0; os=0; on=0; es=0; en=0
        for(i=bn-n+1;i<=bn;i++){s+=bc[i];if(bo[i]+0>0){os+=bo[i];on++};if(be[i]+0>0){es+=be[i];en++}}
        printf "Builder (last %d): avg_cost=$%.2f avg_orient=%.0f%%",n,s/n,(on?os/on:0)
        if(en>0) printf " avg_edits=%.0f",es/en
        if(bn>=2) printf " test_delta=%+d",bt[bn]-bt[bn-1]
        printf "\n"
        n=iq<4?iq:4; s=0
        for(i=iq-n+1;i<=iq;i++) s+=ic[i]
        printf "Improver (last %d): avg_cost=$%.2f\n",n,s/n
      }
    ' "$DIR/metrics.csv" 2>/dev/null || true
    echo ""
    echo "### Current step.sh"; cat "$DIR/step.sh"; echo ""
    echo "### Current builder prompt (build-agent.md)"; cat "$DIR/prompts/build-agent.md"; echo ""
  fi
}

PROMPT="$PROMPT

---

## Injected Context (auto-generated by step.sh — do NOT re-run these commands)

$(generate_context "$TASK")"

printf -v ITERATION_PAD "%06d" "$ITERATION"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_PREFIX="${ITERATION_PAD}-${TASK}-${TIMESTAMP}"
SESSION_LOG="$LOG_DIR/${LOG_PREFIX}.session.jsonl"

# Recover any changes trapped in worktrees from prior iterations.
# The builder may follow AGENTS.md's worktree rule, which means its changes
# end up in .worktrees/<name>/ instead of the main directory. This function
# copies those changes back to main so they aren't lost.
recover_worktrees() {
  for wt_dir in "$DIR"/.worktrees/*/; do
    [ -d "$wt_dir" ] || continue
    local wt_name
    wt_name=$(basename "$wt_dir")
    echo "[step] Recovering trapped changes from worktree: $wt_name"

    # Copy modified/added tracked files
    (cd "$wt_dir" && git diff HEAD --name-only --diff-filter=ACMR 2>/dev/null) | while IFS= read -r file; do
      [ -n "$file" ] || continue
      mkdir -p "$DIR/$(dirname "$file")"
      cp "$wt_dir/$file" "$DIR/$file"
    done

    # Copy new untracked files
    (cd "$wt_dir" && git ls-files --others --exclude-standard 2>/dev/null) | while IFS= read -r file; do
      [ -n "$file" ] || continue
      mkdir -p "$DIR/$(dirname "$file")"
      cp "$wt_dir/$file" "$DIR/$file"
    done

    # Delete files that were removed in the worktree
    (cd "$wt_dir" && git diff HEAD --name-only --diff-filter=D 2>/dev/null) | while IFS= read -r file; do
      [ -n "$file" ] || continue
      rm -f "$DIR/$file"
    done

    # Clean up worktree
    git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
  done

  # Commit recovered changes separately so they don't mix with this iteration
  cd "$DIR"
  if ! git diff --quiet HEAD 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
    git add -A
    git commit -m "recover (iter #$ITERATION): merge trapped worktree changes into main"
    echo "[step] Committed recovered worktree changes"
  fi
}

recover_worktrees

# Run claude
cd "$DIR"
STEP_TIMEOUT="${STEP_TIMEOUT:-900}"
STEP_START=$(date +%s)
CLAUDE_EXIT=0
timeout "$STEP_TIMEOUT" claude -p \
  --verbose \
  --model claude-opus-4-6 \
  --dangerously-skip-permissions \
  --output-format stream-json \
  "$PROMPT" < /dev/null > "$SESSION_LOG" 2>"$LOG_DIR/${LOG_PREFIX}.stderr.log" || CLAUDE_EXIT=$?
STEP_DURATION=$(( $(date +%s) - STEP_START ))

if (( CLAUDE_EXIT == 124 )); then
  echo "[step] claude TIMED OUT after ${STEP_DURATION}s — collecting partial metrics"
elif (( CLAUDE_EXIT != 0 )); then
  echo "[step] claude exited with status $CLAUDE_EXIT (${STEP_DURATION}s)"
  exit "$CLAUDE_EXIT"
fi

echo "[step] claude finished in ${STEP_DURATION}s"

# Recover any worktrees the agent may have created during this iteration
recover_worktrees

# Generate session summary (readable digest for next iteration's agent)
SUMMARY_FILE="$LOG_DIR/${LOG_PREFIX}.summary.md"
python3 "$DIR/scripts/summarize-session.py" "$SESSION_LOG" "$SUMMARY_FILE" 2>/dev/null || true

# Extract orientation overhead percentage from summary
ORIENT_PCT=$(grep -oE '\([0-9]+% of total\)' "$SUMMARY_FILE" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "-")

# Extract edit/write call count from summary
EDIT_WRITE_COUNT=$(grep -E '^- (Edit|Write):' "$SUMMARY_FILE" 2>/dev/null | awk -F': ' '{s+=$2} END {print s+0}' || echo "0")

# Append metrics row (extract cost/turns from session log)
METRICS="$DIR/metrics.csv"
[ -f "$METRICS" ] || echo "iter,task,duration_s,src_files,src_lines,bundle_bytes,smoke_help,smoke_haiku,test_files,tests_passed,cost_usd,num_turns,output_tokens,orient_pct,edit_write_count" > "$METRICS"
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

echo "${ITERATION},${TASK},${STEP_DURATION},${SRC_FILES},${SRC_LINES},${BUNDLE_BYTES},${SMOKE_HELP},${SMOKE_HAIKU},${TEST_FILES},${TESTS_PASSED},${METRICS_ROW},${ORIENT_PCT},${EDIT_WRITE_COUNT}" >> "$METRICS"

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
