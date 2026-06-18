#!/usr/bin/env bash

out=".kota/runs/2026-06-18T13-22-56-683Z-builder-7v9610/history-consolidation/cli-transcript.txt"
stdout_file="${TMPDIR:-/tmp}/kota-history-cli-stdout.$$"
stderr_file="${TMPDIR:-/tmp}/kota-history-cli-stderr.$$"

run() {
  printf '$' >> "$out"
  printf ' %q' "$@" >> "$out"
  printf '\n' >> "$out"

  "$@" > "$stdout_file" 2> "$stderr_file"
  status=$?
  printf 'exit: %s\n' "$status" >> "$out"
  if [ -s "$stdout_file" ]; then
    printf 'stdout:\n' >> "$out"
    sed -n '1,$p' "$stdout_file" >> "$out"
  fi
  if [ -s "$stderr_file" ]; then
    printf 'stderr:\n' >> "$out"
    sed -n '1,$p' "$stderr_file" >> "$out"
  fi
  printf '\n' >> "$out"
}

{
  printf '# history consolidation CLI transcript\n'
  printf '# cwd: %s\n\n' "$(pwd)"
} > "$out"

kota_source=(node --conditions=source --import tsx src/cli.ts)

run "${kota_source[@]}" --help
run "${kota_source[@]}" history --help
run "${kota_source[@]}" history list --help
run "${kota_source[@]}" history search --help
run "${kota_source[@]}" history show --help
run "${kota_source[@]}" history list -n 1
run "${kota_source[@]}" history search ""
run "${kota_source[@]}" history search harness
run "${kota_source[@]}" history search harness --json
run "${kota_source[@]}" history search zz-kota-history-consolidation-no-match-20260618 --keyword
run "${kota_source[@]}" history search zz-kota-history-consolidation-no-match-20260618 --keyword --json
run "${kota_source[@]}" history show missing-id
run "${kota_source[@]}" history search q --limit not-a-number

rm -f "$stdout_file" "$stderr_file"
