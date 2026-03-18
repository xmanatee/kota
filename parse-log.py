#!/usr/bin/env python3
"""Extract structured data from a Claude Code session log (.session.jsonl).

Usage:
    python3 parse-log.py <session-log-path>
    python3 parse-log.py --trend [N]         # last N builder sessions trend

Outputs a concise summary: stats, tool-call sequence, tool counts, errors,
key assistant text blocks, and (for depth builder iterations) an automated
execution analysis — everything the improver needs to assess a builder
iteration without manually parsing JSON.

Trend mode (--trend): parses the last N builder session logs (default 5)
and outputs a cross-session comparison — targeting, severity, efficiency,
and approach rotation — in one call instead of N manual invocations.
"""

import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field


@dataclass
class ToolCall:
    name: str
    detail: str  # display label (description or fallback)
    command: str  # raw command (Bash only)
    file_path: str  # raw file_path (Read/Edit only)


def _is_targeted_test(cmd: str) -> bool:
    """True if cmd is a targeted test run (not full suite).

    Targeted runs (--changed, specific files/dirs) produce subset counts
    that corrupt suite_totals when compared against full-suite counts.
    """
    if not cmd:
        return False
    # Only check test-related commands
    if not any(kw in cmd for kw in ["vitest", "test"]):
        return False
    # --changed runs a subset of the suite
    if "--changed" in cmd:
        return True
    # Specific file/dir targeting: vitest run src/foo.test.ts
    # Full suite: npm test, npx vitest run (no path args)
    if "vitest" in cmd:
        # After "vitest run", if there's a path arg (src/, .test.ts), it's targeted
        m = re.search(r"vitest\s+run\s+(\S+)", cmd)
        if m and (m.group(1).startswith("src") or ".test." in m.group(1)):
            return True
    return False


def parse(path: str) -> None:
    with open(path) as f:
        messages = [json.loads(line) for line in f if line.strip()]

    # --- Result summary ---
    result = next((m for m in messages if m.get("type") == "result"), {})
    print("=== Session Summary ===")
    print(f"  Turns:    {result.get('num_turns', '?')}")
    print(f"  Duration: {result.get('duration_ms', 0) / 1000:.0f}s")
    print(f"  Cost:     ${result.get('total_cost_usd', 0):.4f}")
    usage = result.get("usage", {})
    print(f"  Output tokens: {usage.get('output_tokens', '?')}")
    print(f"  Cache read:    {usage.get('cache_read_input_tokens', '?')}")
    print()

    # --- Collect tool calls and text blocks ---
    tool_calls: list[ToolCall] = []
    tool_counts: Counter = Counter()
    errors: list[str] = []
    text_blocks: list[str] = []       # truncated for display
    full_text_blocks: list[str] = []  # untruncated for analysis
    changelog_edits: list[str] = []   # CHANGELOG Edit new_strings
    suite_totals: list[int] = []      # full-suite test totals from Bash output
    # Map tool_use_id → Bash command for correlating results with commands
    _bash_cmds: dict[str, str] = {}

    for msg in messages:
        if msg.get("type") == "assistant":
            for block in msg.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    name = block["name"]
                    inp = block.get("input", {})
                    desc = inp.get("description", "")
                    command = inp.get("command", "")
                    file_path = inp.get("file_path", "")
                    detail = desc
                    if not detail:
                        if file_path:
                            detail = file_path.split("/")[-1]
                        elif command:
                            detail = command[:80]
                        elif "prompt" in inp:
                            detail = inp["prompt"][:80]
                    tool_calls.append(ToolCall(name, detail, command, file_path))
                    tool_counts[name] += 1
                    # Track Bash commands for suite_totals filtering
                    if name == "Bash" and command:
                        _bash_cmds[block.get("id", "")] = command.lower()
                    # Collect CHANGELOG edit content for test delta fallback
                    if name == "Edit" and file_path.lower().endswith("changelog.md"):
                        ns = inp.get("new_string", "")
                        if ns:
                            changelog_edits.append(ns)
                elif block.get("type") == "text" and block.get("text", "").strip():
                    text = block["text"].strip()
                    if len(text) > 30:
                        text_blocks.append(text[:300])
                        full_text_blocks.append(text)

        elif msg.get("type") == "user":
            content = msg.get("message", {}).get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_result" and block.get("is_error"):
                    err_content = block.get("content", "")
                    if isinstance(err_content, list):
                        err_content = " ".join(
                            c.get("text", "")[:150]
                            for c in err_content
                            if isinstance(c, dict)
                        )
                    elif isinstance(err_content, str):
                        err_content = err_content[:200]
                    if err_content:
                        errors.append(err_content)
                elif block.get("type") == "tool_result":
                    # Skip targeted test runs (--changed, specific files)
                    _tid = block.get("tool_use_id", "")
                    _cmd = _bash_cmds.get(_tid, "")
                    if _is_targeted_test(_cmd):
                        continue
                    _raw = json.dumps(block.get("content", ""))
                    _clean = re.sub(
                        r"\x1b\[[0-9;]*m|\\u001b\[[0-9;]*m|\[[0-9;]*m",
                        "", _raw,
                    )
                    for _m in re.finditer(
                        r"(\d{3,})\s+passed(?:\s*\((\d+)\))?", _clean,
                    ):
                        _n = int(_m.group(2) or _m.group(1))
                        if _n > 500:
                            suite_totals.append(_n)

    # --- Tool call sequence ---
    print(f"=== Tool Call Sequence ({len(tool_calls)} calls) ===")
    for i, tc in enumerate(tool_calls, 1):
        print(f"  {i:3d}. {tc.name:12s} | {tc.detail[:90]}")
    print()

    # --- Tool counts ---
    print("=== Tool Counts ===")
    for name, count in tool_counts.most_common():
        print(f"  {name:12s}: {count}")
    print()

    # --- Errors ---
    if errors:
        print(f"=== Errors ({len(errors)}) ===")
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}")
        print()

    # --- Key text blocks ---
    print(f"=== Key Assistant Text ({len(text_blocks)} blocks) ===")
    for i, text in enumerate(text_blocks, 1):
        display = text.replace("\n", " \\n ")[:200]
        print(f"  {i:3d}. {display}")
    print()

    # --- Builder execution analysis (only for build-agent sessions) ---
    if "build-agent" in path:
        _print_builder_analysis(
            tool_calls, text_blocks, full_text_blocks, changelog_edits,
            suite_totals,
        )


# --- Files that are documentation, not implementation ---
_DOC_FILES = {"changelog.md", "depth-log.md", "notes.md", "design.md"}

# Keep in sync with ALL_APPROACHES in refresh-depth-log.py.
# trend() validates at runtime and warns on mismatch.
DEPTH_APPROACHES = [
    "audit", "friction", "harden", "e2e", "error-paths",
    "structural-health", "concurrency", "resource-lifecycle",
]


def _searchable(tc: ToolCall) -> str:
    """Combined lowercase string for keyword matching."""
    return f"{tc.detail} {tc.command} {tc.file_path}".lower()


def _is_doc_edit(tc: ToolCall) -> bool:
    """True if this Edit targets a documentation file."""
    fp = (tc.file_path or tc.detail).lower()
    return any(fp.endswith(d) for d in _DOC_FILES)


def _extract_test_delta(texts: list[str]) -> str | None:
    """Extract test count delta from text blocks and CHANGELOG edits.

    Priority order:
    1. "N new tests (X→Y ...)" — most explicit
    2. "X→Y" near "test" keyword — contextual arrow pattern
    3. "+N tests" or "N new tests" — count without before/after
    4. Generic "X→Y" with plausible delta — last resort
    """
    # P1: "N new [qualifier] tests (X→Y ...)"
    for text in texts:
        m = re.search(
            r"(\d+)\s+new\s+[\w-]*\s*tests?\s*\((\d+)\s*(?:→|->)\s*(\d+)",
            text, re.I,
        )
        if m:
            return f"{m.group(2)}→{m.group(3)} (+{m.group(1)})"

    # P2: "X tests pass/passed (+N new)" — feature iteration format
    for text in texts:
        m = re.search(r"\d+\s+(?:tests?\s+)?pass(?:ed)?\s+\(\+?(\d+)\s+new", text, re.I)
        if m:
            return f"+{m.group(1)}"

    # P3: "+N tests" or "N new tests" — more precise than generic arrow
    # Negative lookahead excludes "+1 new test file" and "0 new test failures"
    for text in texts:
        m = re.search(r"\+\s*(\d+)\s*(?:new\s+)?tests?(?!\s+file)", text, re.I)
        if m and int(m.group(1)) > 0:
            return f"+{m.group(1)}"
        m = re.search(
            r"(\d+)\s+new\s+(?:[\w-]+\s+)?tests?(?!\s+file)(?!\s+fail)",
            text, re.I,
        )
        if m and int(m.group(1)) > 0:
            return f"+{m.group(1)}"

    # P4: "X→Y" within 60 chars of "test" — broad arrow pattern (false-positive
    # prone when non-test counts like module counts appear near "test" keyword)
    for text in texts:
        for m in re.finditer(r"(\d+)\s*(?:→|->)\s*(\d+)", text):
            before, after = int(m.group(1)), int(m.group(2))
            if not (0 < after - before < 200):
                continue
            start = max(0, m.start() - 60)
            end = min(len(text), m.end() + 60)
            if "test" in text[start:end].lower():
                return f"{before}→{after} (+{after - before})"

    # P5: Generic X→Y with plausible positive delta
    for text in texts:
        m = re.search(r"(\d+)\s*(?:→|->)\s*(\d+)", text)
        if m:
            before, after = int(m.group(1)), int(m.group(2))
            if 0 < after - before < 200:
                return f"{before}→{after} (+{after - before})"

    return None


def _detect_mutation_result(texts: list[str]) -> str | None:
    """Extract mutation check outcome from assistant text.

    Returns a short label: "pass (N/M fail)", "all vacuous", or None.
    """
    for text in texts:
        low = text.lower()
        if "mutation" not in low:
            continue
        # "N of the M new tests fail" or "N/M ... fail"
        m = re.search(r"(\d+)\s+(?:of\s+(?:the\s+)?)?(\d+)\s+new\s+tests?\s+fail", low)
        if m:
            failed, total = int(m.group(1)), int(m.group(2))
            if failed == total:
                return f"pass ({failed}/{total} fail)"
            return f"partial ({failed}/{total} fail)"
        # "mutation check passes" / "mutation check pass"
        if re.search(r"mutation\s+check\s+pass", low):
            return "pass"
        # "all tests pass without" the fix → vacuous
        if re.search(r"all\s+(?:new\s+)?tests?\s+pass\s+without", low):
            return "all vacuous"
        # "vacuous" keyword
        if "vacuous" in low:
            return "vacuous found"
        # "tests? fail" near mutation context
        if re.search(r"tests?\s+fail", low):
            return "pass"
    return None


def _compute_phase_fingerprint(tool_calls: list[ToolCall]) -> str:
    """Compute a phase sequence fingerprint from tool calls.

    Maps each tool call to a phase letter and collapses consecutive duplicates:
      O = Orientation (Read/Bash on doc files: BUILDER_LESSONS, CHANGELOG, etc.)
      R = Research (WebSearch, WebFetch, Agent with research keywords)
      E = Exploration (Read/Grep on source files)
      I = Implementation (Edit/Write on source files)
      V = Verification (Bash: typecheck, test, lint, build, cli.js)
      D = Documentation (Edit on doc files)
    """
    _orient_files = {
        "builder_lessons.md", "builder-lessons.md", "changelog.md",
        "design.md", "notes.md", "depth-log.md",
    }
    _verify_kws = [
        "typecheck", "tsc", "npm run build", "run build",
        "npm test", "vitest", "run test", "biome check", "biome",
        "cli.js",
    ]
    phases = []
    for tc in tool_calls:
        s = _searchable(tc)
        fp_lower = (tc.file_path or tc.detail or "").lower().split("/")[-1]

        # Research
        if tc.name in ("WebSearch", "WebFetch"):
            phases.append("R")
            continue
        if tc.name == "Agent":
            phases.append("R")
            continue

        # Orientation: reading known doc/config files
        if tc.name in ("Read", "Bash") and any(of in s for of in _orient_files):
            phases.append("O")
            continue
        if tc.name == "Bash" and any(kw in s for kw in ["git log", "git diff", "npm test", "npm info"]):
            # git log during orient, npm test health check
            if not phases or phases[-1] in ("O", ""):
                phases.append("O")
                continue

        # Verification
        if tc.name == "Bash" and any(kw in s for kw in _verify_kws):
            phases.append("V")
            continue

        # Documentation edits
        if tc.name == "Edit" and _is_doc_edit(tc):
            phases.append("D")
            continue

        # Implementation edits
        if tc.name in ("Edit", "Write") and not _is_doc_edit(tc):
            phases.append("I")
            continue

        # Exploration (Read/Grep on source)
        if tc.name in ("Read", "Grep", "Glob"):
            phases.append("E")
            continue

        # Bash exploration (ls, cat source, etc.) — not orient, verify, or research
        if tc.name == "Bash":
            phases.append("E")
            continue

        # TodoWrite, ToolSearch, and other meta-tools — skip
        if tc.name in ("TodoWrite", "ToolSearch"):
            continue
        phases.append("?")

    # Collapse consecutive duplicates
    if not phases:
        return ""
    collapsed = [phases[0]]
    for p in phases[1:]:
        if p != collapsed[-1]:
            collapsed.append(p)
    return "→".join(collapsed)


def _print_builder_analysis(
    tool_calls: list[ToolCall],
    text_blocks: list[str],
    full_text_blocks: list[str] | None = None,
    changelog_edits: list[str] | None = None,
    suite_totals: list[int] | None = None,
) -> None:
    all_text = " ".join(text_blocks).lower()

    is_depth = "depth" in all_text or any(
        f"approach: {a}" in all_text or f"approach**: {a}" in all_text
        for a in DEPTH_APPROACHES
    )
    if not is_depth:
        is_depth = any(
            kw in all_text
            for kw in ["stale", "neglected", "rotation", "gap matrix"]
        )

    # --- Universal process quality analysis (all builder sessions) ---
    print("=== Process Quality ===")

    # 1. Phase fingerprint — structural view of the session
    fingerprint = _compute_phase_fingerprint(tool_calls)
    print(f"  Phases:       {fingerprint}")

    # 2. Pre-edit investigation: reads before first implementation edit
    first_impl_edit = None
    source_reads = 0
    test_reads = 0
    for i, tc in enumerate(tool_calls):
        if tc.name == "Edit" and not _is_doc_edit(tc):
            first_impl_edit = i
            break
        if tc.name == "Read":
            fp = (tc.file_path or tc.detail).lower()
            if "test" in fp:
                test_reads += 1
            elif fp.endswith((".ts", ".js")):
                source_reads += 1
    total = source_reads + test_reads
    print(f"  Pre-edit reads: {total} ({source_reads} source, {test_reads} test)")

    # 3. Read focus: what fraction of Read calls target files that are edited?
    read_files = set()
    edited_files = set()
    for tc in tool_calls:
        fp = (tc.file_path or "").lower().split("/")[-1]
        if not fp or fp in _DOC_FILES:
            continue
        if tc.name == "Read" and fp.endswith((".ts", ".js")):
            read_files.add(fp)
        if tc.name == "Edit" and fp.endswith((".ts", ".js")):
            edited_files.add(fp)
    if read_files:
        focused = len(read_files & edited_files)
        focus_pct = round(focused / len(read_files) * 100)
        print(f"  Read focus:   {focus_pct}% ({focused}/{len(read_files)} read files were edited)")

    # 4. Fix-verify cycles: edit -> [verify/diagnostic] -> test -> [diagnostic] -> re-edit
    # Only Write (new file) and Agent (delegation) break the chain.
    cycles = 0
    saw_edit = False
    saw_test_after_edit = False
    for tc in tool_calls:
        if _is_doc_edit(tc):
            continue
        is_edit = tc.name == "Edit"
        s = _searchable(tc)
        is_test = tc.name == "Bash" and any(
            kw in s for kw in ["test", "vitest", "npm test"]
        )
        is_new_phase = (
            (tc.name == "Write" and not _is_doc_edit(tc))
            or tc.name == "Agent"
        )
        if saw_test_after_edit and is_edit:
            cycles += 1
        if is_edit:
            saw_edit = True
            saw_test_after_edit = False
        elif is_test and saw_edit:
            saw_test_after_edit = True
            saw_edit = False
        elif is_new_phase:
            saw_edit = False
            saw_test_after_edit = False

    print(f"  Fix-verify:   {cycles} cycle(s)")

    # 5. Verification levels — check both description and command
    checks = {"typecheck": False, "build": False, "test": False, "load": False}
    for tc in tool_calls:
        if tc.name != "Bash":
            continue
        s = _searchable(tc)
        if "typecheck" in s or "tsc" in s:
            checks["typecheck"] = True
        if "npm run build" in s or "run build" in s or (
            "build" in s and "typecheck" not in s
        ):
            checks["build"] = True
        if any(kw in s for kw in ["npm test", "vitest", "run test"]):
            checks["test"] = True
        if "cli.js" in s:
            checks["load"] = True
    status = "  ".join(
        f"{k} {'ok' if v else 'MISS'}" for k, v in checks.items()
    )
    print(f"  Verification: {status}")

    # 6. Test delta — primary: actual test suite totals, fallback: text patterns
    test_delta = None
    st = suite_totals or []
    if len(st) >= 2:
        delta = st[-1] - st[0]
        test_delta = (
            f"{st[0]}→{st[-1]} (+{delta})" if delta > 0
            else "+0" if delta == 0 else f"{st[0]}→{st[-1]} ({delta})"
        )
    if not test_delta:
        search_texts = (full_text_blocks or text_blocks) + (changelog_edits or [])
        test_delta = _extract_test_delta(search_texts)
    print(f"  Test delta:   {test_delta or '?'}")

    # 7. Source files edited (scope of changes)
    edited = sorted(set(
        (tc.file_path or tc.detail).split("/")[-1]
        for tc in tool_calls
        if tc.name == "Edit" and not _is_doc_edit(tc)
    ))
    if edited:
        print(f"  Files edited: {', '.join(edited)}")

    # --- Depth-specific analysis (only for depth iterations) ---
    if not is_depth:
        print()
        return

    print()
    print("=== Depth Analysis ===")

    # D1. Refresh check — search both description and command
    refresh_idx = None
    read_depth_idx = None
    for i, tc in enumerate(tool_calls):
        s = _searchable(tc)
        if refresh_idx is None and "refresh-depth-log" in s:
            refresh_idx = i
        if read_depth_idx is None and "depth-log" in s and "refresh" not in s:
            if tc.name in ("Read", "Bash"):
                read_depth_idx = i

    if refresh_idx is not None and read_depth_idx is not None:
        ok = refresh_idx < read_depth_idx
        sym = "ok" if ok else "WRONG ORDER"
        print(f"  Refresh:      call #{refresh_idx+1} -> read #{read_depth_idx+1} ({sym})")
    elif refresh_idx is not None:
        print(f"  Refresh:      call #{refresh_idx+1} (no depth-log Read detected)")
    else:
        print("  Refresh:      NOT FOUND")

    # D2. Target extraction — structured format first, then fallback patterns
    target_module = None
    target_approach = None

    # Primary: structured "**Depth pick**: `module` / `approach`"
    _structured_pat = (
        r"\*\*Depth pick\*\*:\s*`([^`]+)`\s*/\s*`([^`]+)`"
    )
    for text in text_blocks:
        m = re.search(_structured_pat, text)
        if m:
            target_module = m.group(1)
            raw_approach = m.group(2).lower()
            for a in DEPTH_APPROACHES:
                if raw_approach.startswith(a):
                    target_approach = a
                    break
            if not target_approach:
                target_approach = raw_approach
            break

    # Fallback: natural-language patterns (for older logs)
    if not target_module or not target_approach:
        _mod_patterns = [
            r"(?:module|depth)\s*(?:phase\s*)?(?:pick|target|choice)[:\s`*]*"
            r"([a-zA-Z0-9_./-]+\.ts)",
            r"[`*]+([a-zA-Z0-9_./-]+\.ts)[`*]+\s*(?:\(|—|--)\s*(?:most\s+)?(?:neglected|stale)",
            r"(?:most\s+)?(?:neglected|stale)[:\s]+(?:module\s+(?:is\s+)?)?[`*]+([a-zA-Z0-9_./-]+\.ts)",
        ]
        _app_patterns = [
            r"(?:I'll|I will)\s+(?:pick|use)\s+(?:the\s+)?\*\*(\w[\w-]+)",
            r"approach[*:\s]+(\w[\w-]+)",
            r"\*\*(\w[\w-]+)\*\*\s+approach",
        ]
        for text in text_blocks:
            if not target_module:
                for pat in _mod_patterns:
                    m = re.search(pat, text, re.I)
                    if m:
                        target_module = m.group(1)
                        break
            if not target_approach:
                for pat in _app_patterns:
                    m = re.search(pat, text, re.I)
                    if m and m.group(1).lower() in DEPTH_APPROACHES:
                        target_approach = m.group(1).lower()
                        break
    print(f"  Target:       {target_module or '?'} / {target_approach or '?'}")

    # D3. Sweep: total calls between mutation check and verification
    post_greps = 0
    if first_impl_edit is not None:
        for tc in tool_calls[first_impl_edit + 1:]:
            if tc.name == "Grep":
                post_greps += 1
    mutation_last = -1
    for i, tc in enumerate(tool_calls):
        s = _searchable(tc)
        if tc.name == "Bash" and (
            "mutation" in s or "_mut_backup" in s
            or ("stash" in s and any(kw in s for kw in ["revert", "verify", "check", "fail"]))
        ):
            mutation_last = i
    sweep_total = 0
    if mutation_last >= 0:
        verify_first = len(tool_calls)
        for i in range(mutation_last + 1, len(tool_calls)):
            tc = tool_calls[i]
            s = _searchable(tc)
            if tc.name == "Bash" and ("typecheck" in s or "tsc" in s):
                verify_first = i
                break
        sweep_total = max(0, verify_first - mutation_last - 1)
    if sweep_total > 0:
        print(f"  Sweep:        {sweep_total} call(s) between mutation and verification")
    else:
        print(f"  Sweep:        {post_greps} Grep call(s) after first impl Edit")

    # D4. Mutation check — did the builder verify new tests catch the bug?
    mutation_calls = 0
    for tc in tool_calls:
        if tc.name != "Bash":
            continue
        s = _searchable(tc)
        if "mutation" in s or ("stash" in s and any(
            kw in s for kw in ["revert", "verify", "check", "fail"]
        )):
            mutation_calls += 1
    mutation_result = _detect_mutation_result(full_text_blocks or text_blocks)
    if mutation_calls > 0:
        detail = f"ran ({mutation_calls} call{'s' if mutation_calls > 1 else ''})"
        if mutation_result:
            detail += f", {mutation_result}"
        print(f"  Mutation:     {detail}")
    else:
        print("  Mutation:     NOT FOUND")
    print()


# --- Trend analysis: cross-session comparison of recent builders ---


def _load_changelog_titles() -> dict[int, str]:
    """Extract iteration titles + summary from CHANGELOG.md and archive.

    Returns heading text combined with the first summary line (if any),
    giving richer context for work-type classification.
    """
    from pathlib import Path
    base = Path(__file__).parent
    titles = {}
    for name in ["CHANGELOG.md", "CHANGELOG.archive.md"]:
        path = base / name
        if not path.exists():
            continue
        lines = path.read_text().split("\n")
        for i, line in enumerate(lines):
            m = re.match(r"^## Iteration (\d+)\s*[\u2014\u2013-]\s*(.+)", line)
            if m:
                heading = m.group(2).strip()
                # Grab first non-empty, non-heading line as summary
                summary = ""
                for j in range(i + 1, min(i + 5, len(lines))):
                    s = lines[j].strip()
                    if s and not s.startswith("#"):
                        summary = s
                        break
                titles[int(m.group(1))] = (
                    f"{heading} {summary}" if summary else heading
                )
    return titles


def _slugify_title(title: str, max_len: int = 22) -> str:
    """Convert a CHANGELOG title to a short slug for trend display."""
    # Take first segment before : or em/en dash
    seg = re.split(r"[:\u2014\u2013]", title)[0].strip()
    slug = seg.lower().replace(" ", "-").replace("_", "-")
    slug = re.sub(r"[^a-z0-9-]", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    if len(slug) <= max_len:
        return slug
    # Truncate at last hyphen within limit for readability
    truncated = slug[:max_len]
    last_dash = truncated.rfind("-")
    if last_dash > max_len // 2:
        return truncated[:last_dash]
    return truncated


def _find_builder_logs(n: int) -> list[tuple[int, str]]:
    """Find the last N builder session logs, return [(iter_num, path)]."""
    from pathlib import Path
    log_dir = Path(__file__).parent / "logs"
    logs = []
    for f in log_dir.glob("*-build-agent-*.session.jsonl"):
        m = re.match(r"(\d+)-", f.name)
        if m:
            logs.append((int(m.group(1)), str(f)))
    logs.sort(reverse=True)
    return logs[:n]


def _quick_parse(path: str) -> dict:
    """Lightweight session log parse — extracts only trend-relevant metrics."""
    with open(path) as f:
        messages = [json.loads(line) for line in f if line.strip()]
    result = next((m for m in messages if m.get("type") == "result"), {})
    tool_count = 0
    mutation_calls = 0
    web_research = False
    research_calls = 0
    text_snippets: list[str] = []
    full_texts: list[str] = []
    cl_edits: list[str] = []
    error_count = 0
    tc_list: list[tuple[str, str]] = []  # (name, searchable) for sweep
    # Track full-suite test totals for reliable delta computation
    _suite_totals: list[int] = []
    _ansi_re = re.compile(r"\x1b\[[0-9;]*m|\\u001b\[[0-9;]*m|\[[0-9;]*m")
    # Map tool_use_id → Bash command for filtering targeted test runs
    _bash_cmds: dict[str, str] = {}

    for msg in messages:
        if msg.get("type") == "user":
            content = msg.get("message", {}).get("content", [])
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_result" and block.get("is_error"):
                        error_count += 1
                    elif block.get("type") == "tool_result":
                        # Skip targeted test runs (--changed, specific files)
                        _tid = block.get("tool_use_id", "")
                        _cmd = _bash_cmds.get(_tid, "")
                        if _is_targeted_test(_cmd):
                            continue
                        _raw = json.dumps(block.get("content", ""))
                        _clean = _ansi_re.sub("", _raw)
                        for _m in re.finditer(
                            r"(\d{3,})\s+passed(?:\s*\((\d+)\))?", _clean,
                        ):
                            _n = int(_m.group(2) or _m.group(1))
                            if _n > 500:
                                _suite_totals.append(_n)
            continue
        if msg.get("type") != "assistant":
            continue
        for block in msg.get("message", {}).get("content", []):
            if block.get("type") == "tool_use":
                tool_count += 1
                inp = block.get("input", {})
                _desc = (inp.get("description", "") or "").lower()
                _cmd = (inp.get("command", "") or "").lower()
                _fp = (inp.get("file_path", "") or "").lower()
                tc_list.append((block["name"], f"{_desc} {_cmd} {_fp}"))
                if block["name"] in ("WebSearch", "WebFetch"):
                    web_research = True
                    research_calls += 1
                if block["name"] == "Agent":
                    _prompt = (inp.get("prompt", "") or inp.get("description", "") or "").lower()
                    if any(kw in _prompt for kw in ["research", "search the web", "web search", "survey", "look up", "investigate"]):
                        web_research = True
                        research_calls += 1
                if block["name"] == "Bash":
                    # Track Bash commands for suite_totals filtering
                    _bash_cmds[block.get("id", "")] = _cmd
                    desc = (inp.get("description", "") or "").lower()
                    cmd = (inp.get("command", "") or "").lower()
                    s = f"{desc} {cmd}"
                    if "mutation" in s or ("stash" in s and any(
                        kw in s for kw in ["revert", "verify", "check", "fail"]
                    )):
                        mutation_calls += 1
                if block["name"] == "Edit" and (
                    inp.get("file_path", "") or ""
                ).lower().endswith("changelog.md"):
                    ns = inp.get("new_string", "")
                    if ns:
                        cl_edits.append(ns)
            elif block.get("type") == "text":
                text = (block.get("text") or "").strip()
                if len(text) > 30:
                    text_snippets.append(text[:300])
                    full_texts.append(text)
    # Target extraction — structured format first, then fallback
    target_mod = target_app = None
    pat = r"\*\*Depth pick\*\*:\s*`([^`]+)`\s*/\s*`([^`]+)`"
    for t in text_snippets:
        m = re.search(pat, t)
        if m:
            target_mod = m.group(1)
            raw = m.group(2).lower()
            for a in DEPTH_APPROACHES:
                if raw.startswith(a):
                    target_app = a
                    break
            if not target_app:
                target_app = raw
            break
    # Fallback patterns for older logs without structured format
    if not target_mod or not target_app:
        _mod_pats = [
            r"(?:module|depth)\s*(?:phase\s*)?(?:pick|target|choice)[:\s`*]*"
            r"([a-zA-Z0-9_./-]+\.ts)",
            r"[`*]+([a-zA-Z0-9_./-]+\.ts)[`*]+\s*(?:\(|—|--)\s*(?:most\s+)?"
            r"(?:neglected|stale)",
            r"(?:most\s+)?(?:neglected|stale)[:\s]+(?:module\s+(?:is\s+)?)?"
            r"[`*]+([a-zA-Z0-9_./-]+\.ts)",
        ]
        _app_pats = [
            r"approach[*:\s]+(\w[\w-]+)",
            r"\*\*(\w[\w-]+)\*\*\s+approach",
        ]
        for t in text_snippets:
            if not target_mod:
                for p in _mod_pats:
                    m = re.search(p, t, re.I)
                    if m:
                        target_mod = m.group(1)
                        break
            if not target_app:
                for p in _app_pats:
                    m = re.search(p, t, re.I)
                    if m and m.group(1).lower() in DEPTH_APPROACHES:
                        target_app = m.group(1).lower()
                        break
    # Sweep: total calls between last mutation-related call and first verification
    sweep_calls = 0
    if mutation_calls > 0:
        mutation_last = -1
        for i, (name, s) in enumerate(tc_list):
            if name == "Bash" and (
                "mutation" in s or "_mut_backup" in s
                or ("stash" in s and any(kw in s for kw in ["revert", "verify", "check", "fail"]))
            ):
                mutation_last = i
        if mutation_last >= 0:
            verify_first = len(tc_list)
            for i in range(mutation_last + 1, len(tc_list)):
                name, s = tc_list[i]
                if name == "Bash" and ("typecheck" in s or "tsc" in s):
                    verify_first = i
                    break
            sweep_calls = max(0, verify_first - mutation_last - 1)

    # Classify work type: "depth" if module/approach detected, else "feature"
    # (architecture detection happens in trend() using CHANGELOG titles, which
    # reliably reflect what was built — assistant text includes brainstorm
    # candidates that weren't chosen, causing false positives)
    work_type = "depth" if (target_mod and target_app) else "feature"

    # Return-edit ratio: fraction of Write/Edit calls that target files
    # already written/edited earlier in the session. Measures "getting it right
    # the first time" without being inflated by multi-feature scope.
    _doc_files_re = {"changelog.md", "depth-log.md", "notes.md", "design.md",
                     "builder_lessons.md"}
    _edited_files: set[str] = set()
    _total_impl_calls = 0
    _return_edits = 0
    for name, s in tc_list:
        if name not in ("Write", "Edit"):
            continue
        if any(d in s for d in _doc_files_re):
            continue
        _total_impl_calls += 1
        # Extract file path: last whitespace-separated token (from _fp)
        fp = s.rsplit(" ", 1)[-1].strip() if s.strip() else ""
        if not fp:
            continue
        if fp in _edited_files:
            _return_edits += 1
        else:
            _edited_files.add(fp)
    return_edit_ratio = (
        round(_return_edits / _total_impl_calls * 100)
        if _total_impl_calls > 0 else 0
    )
    edits_per_file = (
        round(_total_impl_calls / len(_edited_files), 1)
        if _edited_files else 0
    )

    # Post-implementation rework analysis: what fraction of calls come after
    # the first verification attempt following implementation?
    _doc_files = {"changelog.md", "depth-log.md", "notes.md", "design.md"}
    _verify_kws = [
        "typecheck", "tsc --noemit", "npm run build", "run build",
        "npm test", "vitest", "run test", "biome check", "cli.js",
    ]
    first_impl = None
    first_verify_after_impl = None
    fix_cycles = 0
    # Fix-cycle detection: edit → [verify/diagnostic chain] → test → [diagnostic
    # chain] → re-edit.  Only Write (new file = new phase) and Agent (delegation)
    # break the chain.  Read, Grep, Bash(verify/diagnostic), TodoWrite are part
    # of the verify→diagnose→fix flow.  Previous algorithm (iter 586) was too
    # strict: any non-edit/non-test call reset _saw_edit, missing fix cycles
    # where typecheck/build calls separated edit from test (iter 601: 2 real
    # fix cycles reported as 0; iter 605: 1 real fix cycle reported as 0).
    _saw_edit = False
    _saw_test_after_edit = False
    _test_kws = ["npm test", "vitest", "run test"]
    for i, (name, s) in enumerate(tc_list):
        is_impl = (
            name in ("Write", "Edit")
            and not any(d in s for d in _doc_files)
        )
        is_edit = name == "Edit" and not any(d in s for d in _doc_files)
        is_test = name == "Bash" and any(kw in s for kw in _test_kws)
        is_verify = name == "Bash" and any(kw in s for kw in _verify_kws)
        is_new_phase = (
            (name == "Write" and not any(d in s for d in _doc_files))
            or name == "Agent"
        )
        if first_impl is None and is_impl:
            first_impl = i
        if first_impl is not None and first_verify_after_impl is None and is_verify:
            first_verify_after_impl = i
        # Fix cycle = edit → test → re-edit (with verify/diagnostic allowed
        # between edit→test and diagnostic allowed between test→edit)
        if _saw_test_after_edit and is_edit:
            fix_cycles += 1
        if is_edit:
            _saw_edit = True
            _saw_test_after_edit = False
        elif is_test and _saw_edit:
            _saw_test_after_edit = True
            _saw_edit = False
        elif is_new_phase:
            _saw_edit = False
            _saw_test_after_edit = False
    rework_pct = 0
    if first_verify_after_impl is not None and tc_list:
        remaining = len(tc_list) - first_verify_after_impl - 1
        rework_pct = round(remaining / len(tc_list) * 100)

    # Count verification command runs by type (how many times each check ran)
    verify_runs = {"typecheck": 0, "test": 0, "lint": 0, "build": 0}
    for name, s in tc_list:
        if name != "Bash":
            continue
        if "typecheck" in s or "tsc" in s:
            verify_runs["typecheck"] += 1
        if any(kw in s for kw in ["npm test", "vitest", "run test"]):
            verify_runs["test"] += 1
        if "biome" in s:
            verify_runs["lint"] += 1
        if "npm run build" in s or "run build" in s or (
            "build" in s and "typecheck" not in s and "biome" not in s
        ):
            verify_runs["build"] += 1

    usage = result.get("usage", {})
    turns = result.get("num_turns", 0) or 0
    cache_read = usage.get("cache_read_input_tokens", 0) or 0
    return {
        "turns": turns,
        "cost": result.get("total_cost_usd", 0) or 0,
        "calls": tool_count,
        "module": target_mod,
        "approach": target_app,
        "work_type": work_type,
        "test_delta": (
            # Primary: compute from actual test run totals (first vs last)
            f"{_suite_totals[0]}→{_suite_totals[-1]} (+{_suite_totals[-1] - _suite_totals[0]})"
            if len(_suite_totals) >= 2 and _suite_totals[-1] > _suite_totals[0]
            else (
                "+0" if len(_suite_totals) >= 2 and _suite_totals[-1] == _suite_totals[0]
                else None
            )
        ) or _extract_test_delta(full_texts + cl_edits),
        "mutation": "ran" if mutation_calls > 0 else "no",
        "cache_read": cache_read,
        "cache_per_turn": round(cache_read / turns) if turns else 0,
        "error_count": error_count,
        "sweep_calls": sweep_calls,
        "web_research": web_research,
        "research_calls": research_calls,
        "rework_pct": rework_pct,
        "fix_cycles": fix_cycles,
        "verify_runs": verify_runs,
        "return_edit_pct": return_edit_ratio,
        "edits_per_file": edits_per_file,
        "edited_file_count": len(_edited_files),
        "edited_files": set(_edited_files),
    }


def _load_depth_log() -> tuple[dict[int, str], list[dict]]:
    """Read depth-log.md main table. Returns (severity_map, rows)."""
    from pathlib import Path
    depth_log = Path(__file__).parent / "depth-log.md"
    if not depth_log.exists():
        return {}, []
    sevs: dict[int, str] = {}
    rows: list[dict] = []
    for line in depth_log.read_text().split("\n"):
        m = re.match(
            r"\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*(\S+)\s*\|\s*(.+?)\s*\|",
            line,
        )
        if m and m.group(1).isdigit():
            it = int(m.group(1))
            sevs[it] = m.group(4).strip()
            rows.append({
                "iter": it,
                "approach": m.group(2).strip(),
                "modules": [mod.strip() for mod in m.group(3).split(",")],
            })
    return sevs, rows


def _depth_health(
    rows: list[dict],
    session_activity: dict[str, int] | None = None,
) -> dict:
    """Compute depth phase health metrics from depth-log rows + session data."""
    from pathlib import Path
    src = Path(__file__).parent / "src"
    # Count source files ≥200 lines (same logic as refresh-depth-log.py)
    source_files: dict[str, int] = {}
    exclude = {"web-ui-client.ts", "web-ui-styles.ts"}
    for subdir in [src, src / "tools", src / "modules"]:
        if not subdir.exists():
            continue
        for f in subdir.glob("*.ts"):
            if ".test." in f.name or ".integration." in f.name:
                continue
            rel = str(f.relative_to(src))
            if rel not in exclude:
                source_files[rel] = sum(1 for _ in f.open())
    big_modules = {p for p, n in source_files.items() if n >= 200}
    if not big_modules:
        return {}

    # Build coverage map from depth-log rows
    covered: dict[str, list[tuple[int, str]]] = {}
    for row in rows:
        for mod_name in row["modules"]:
            # Resolve module name to source file path
            resolved = []
            if "*" in mod_name:
                prefix = mod_name.replace("*.ts", "").rstrip("/")
                resolved = [f for f in source_files if f.startswith(prefix + "/")]
            elif mod_name in source_files:
                resolved = [mod_name]
            else:
                for pfx in ["", "tools/", "modules/"]:
                    c = pfx + mod_name
                    if c in source_files:
                        resolved = [c]
                        break
            for path in resolved:
                covered.setdefault(path, []).append((row["iter"], row["approach"]))

    # Merge auto-detected activity from recent builder sessions.
    # A module edited in a session isn't maximally stale even without a
    # depth-log entry.  Tagged "session" so it doesn't count toward formal
    # depth approach combos.
    if session_activity:
        for rel_path, iter_num in session_activity.items():
            if rel_path in big_modules:
                covered.setdefault(rel_path, []).append((iter_num, "session"))

    all_iters = [r["iter"] for r in rows]
    if session_activity:
        all_iters.extend(session_activity.values())
    max_iter = max(all_iters) if all_iters else 0
    stale_count = 0
    total_combos = 0
    tried_combos = 0
    for path in big_modules:
        if path not in covered:
            stale_count += 1  # uncovered = maximally stale
            total_combos += len(DEPTH_APPROACHES)
            continue
        last_iter = max(i for i, _ in covered[path])
        builder_iters_ago = (max_iter - last_iter) // 2
        if builder_iters_ago >= 10:
            stale_count += 1
            total_combos += len(DEPTH_APPROACHES)
            tried = len(set(a for _, a in covered[path] if a != "session"))
            tried_combos += tried
        else:
            total_combos += len(DEPTH_APPROACHES)
            tried = len(set(a for _, a in covered[path] if a != "session"))
            tried_combos += tried

    distinct_modules = len(set(p for p in covered if p in big_modules))
    # Approach sync check: compare DEPTH_APPROACHES against approaches in rows
    log_approaches = set(r["approach"] for r in rows)
    known_set = set(DEPTH_APPROACHES)
    unknown = log_approaches - known_set

    # Top neglected modules: never-covered first, then most stale
    neglected: list[tuple[str, int | None, int]] = []  # (path, last_iter|None, lines)
    for path in big_modules:
        lines = source_files.get(path, 0)
        if path not in covered:
            neglected.append((path, None, lines))
        else:
            last_iter = max(i for i, _ in covered[path])
            builder_iters_ago = (max_iter - last_iter) // 2
            if builder_iters_ago >= 10:
                neglected.append((path, last_iter, lines))
    # Sort: never-covered first (None → -inf), then oldest last_iter, then largest files
    neglected.sort(key=lambda x: (x[1] if x[1] is not None else -1, -x[2]))

    return {
        "total_iters": len(rows),
        "distinct_modules": distinct_modules,
        "total_big": len(big_modules),
        "stale": stale_count,
        "untried": total_combos - tried_combos,
        "total_combos": total_combos,
        "unknown_approaches": unknown,
        "top_neglected": neglected[:5],
    }


def _classify_subsystem(title: str) -> str:
    """Classify a CHANGELOG title into a top-level subsystem for concentration detection."""
    t = title.lower().replace("`", "")
    # Order matters: more specific patterns first
    if any(kw in t for kw in ["batch", "pipe", "map tool", "scatter-gather", "sequential chain", "composition primitive"]):
        return "tools/orch"
    if any(kw in t for kw in ["view_image", "image", "screenshot", "clipboard", "document read", "computer use", "pdf", "visual"]):
        return "tools/io"
    if any(kw in t for kw in ["tool group", "tool filter", "progressive disclosure", "tool routing", "tool set", "default tool"]):
        return "tools/routing"
    if any(kw in t for kw in ["script", "step", "event handler", "conditional", "manifest", "$steps"]):
        return "modules/manifest"
    if any(kw in t for kw in ["modulecontext", "module context", "ctx.", "event proxy", "session factory", "dependency inject"]):
        return "modules/ctx"
    if any(kw in t for kw in ["secret", "credential", "keychain", "injection guard"]):
        return "other"
    if any(kw in t for kw in ["provider", "sqlite", "memory backend", "alternative backend", "model client", "modelclient", "openai-compatible"]):
        return "modules/provider"
    if any(kw in t for kw in ["log storage", "persistent log", "audit trail", "module log"]):
        return "modules/logging"
    if any(kw in t for kw in ["registry", "self-register", "observation mask", "context manag"]):
        return "architecture"
    if any(kw in t for kw in ["tool", "built"]):
        return "tools"
    if any(kw in t for kw in ["module", "mcp"]):
        return "modules"
    return "other"


# Map subsystems to broad domains for concentration detection.
# Domain-level tracking catches drift that subsystem-level misses
# (e.g., tools/orch → tools/routing still = "tools" domain).
_SUBSYSTEM_TO_DOMAIN = {
    "tools/orch": "tools",
    "tools/io": "tools",
    "tools/routing": "tools",
    "tools": "tools",
    "modules/manifest": "modules",
    "modules/ctx": "modules",
    "modules/provider": "modules",
    "modules/logging": "modules",
    "modules": "modules",
    "architecture": "architecture",
    "other": "other",
}


def _get_domain(subsystem: str) -> str:
    """Map a subsystem label to its broad domain."""
    return _SUBSYSTEM_TO_DOMAIN.get(subsystem, "other")


def trend(n: int = 5) -> None:
    """Cross-session trend of the last N builder iterations."""
    logs = _find_builder_logs(n)
    if not logs:
        print("No builder session logs found.")
        return
    sevs, depth_rows = _load_depth_log()
    cl_titles = _load_changelog_titles()
    entries = []
    for iter_num, path in reversed(logs):  # chronological order
        data = _quick_parse(path)
        data["iter"] = iter_num
        data["severity"] = sevs.get(iter_num, "?")
        # For non-depth iterations, extract name and subsystem from CHANGELOG title
        if data["work_type"] != "depth" and iter_num in cl_titles:
            data["feature_name"] = _slugify_title(cl_titles[iter_num])
            data["subsystem"] = _classify_subsystem(cl_titles[iter_num])
            # Reclassify using CHANGELOG title+summary as additional signal
            if data["work_type"] == "feature":
                title_low = cl_titles[iter_num].lower()
                _title_arch_kws = [
                    "refactor", "isolat", "self-contained", "decouple",
                    "module context", "modulecontext", "restructur",
                    "api boundary", "plug-and-play",
                    "event proxy", "session factory", "dependency inject",
                    "singleton", "module api", "module event",
                    "module isolat", "core import", "context ext",
                    "provider", "registry", "self-register",
                    "calltool", "call_tool", "tool invocation",
                    "tool composition", "composab", "step-based",
                    # Added iter 602: architecture keywords that were missing
                    "middleware", "telemetry", "instrumentat",
                    "state machine", "lifecycle", "state pattern",
                    "intercept", "hook system",
                ]
                _title_harden_kws = [
                    "e2e test", "end-to-end test", "harden",
                    "stress test", "fuzz", "error path", "error recover",
                    "reliability", "resilien", "integration test",
                    "composition test", "regression",
                ]
                # Check hardening first (more specific) then architecture
                if any(kw in title_low for kw in _title_harden_kws):
                    data["work_type"] = "hardening"
                elif any(kw in title_low for kw in _title_arch_kws):
                    data["work_type"] = "architecture"
        else:
            data["subsystem"] = "other"
        data["domain"] = _get_domain(data.get("subsystem", "other"))
        entries.append(data)

    print(f"=== Builder Trend (last {len(entries)}) ===")
    total_calls = total_tests = test_count = 0
    total_cost = 0.0
    cpt_values: list[int] = []
    for e in entries:
        mod = e.get("feature_name") or e["module"] or "?"
        if "/" in mod:
            mod = mod.split("/")[-1]
        is_depth = e["work_type"] == "depth"
        app = e["approach"] or e["work_type"]
        subsys = e.get("subsystem", "?")
        td = e["test_delta"] or "?"
        cpt = e.get("cache_per_turn", 0)
        cpt_str = f"{cpt // 1000}k" if cpt else "?"
        errs = e.get("error_count", 0)
        sweep = e.get("sweep_calls", 0)
        rc = e.get("research_calls", 0)
        research = str(rc) if rc > 0 else "."
        rework = e.get("rework_pct", 0)
        fix_c = e.get("fix_cycles", 0)
        rework_str = f"{rework}%/{fix_c}" if rework else "0%"
        re_pct = e.get("return_edit_pct", 0)
        re_str = f"{re_pct}%" if re_pct else "0%"
        print(
            f"  {e['iter']}  {mod:<22s} {subsys:<18s}"
            f" {e['calls']:>3d} calls  ${e['cost']:.2f}  tests: {td}"
            f"  ctx: {cpt_str}/turn  errs: {errs}  sweep: {sweep}"
            f"  rsrch: {research:<3s} rework: {rework_str}  re-edit: {re_str}"
        )
        total_calls += e["calls"]
        total_cost += e["cost"]
        if cpt:
            cpt_values.append(cpt)
        m = re.search(r"\+(\d+)", str(td))
        if m:
            total_tests += int(m.group(1))
            test_count += 1

    ne = len(entries)
    avg_calls = total_calls / ne if ne else 0
    avg_cost = total_cost / ne if ne else 0
    avg_tests = total_tests / test_count if test_count else 0
    print(
        f"  Avg: {avg_calls:.0f} calls, ${avg_cost:.2f}, "
        f"+{avg_tests:.1f} tests/iter"
    )
    # Error and sweep aggregates
    total_errors = sum(e.get("error_count", 0) for e in entries)
    total_sweep = sum(e.get("sweep_calls", 0) for e in entries)
    avg_sweep = total_sweep / ne if ne else 0
    if total_errors > 0 or total_sweep > 0:
        print(
            f"  Errors: {total_errors} total ({total_errors / ne:.1f}/iter)"
            f"  Sweep: {total_sweep} total ({avg_sweep:.0f}/iter avg)"
        )
    # Rework: post-verification overhead (% of calls after first verify, fix cycles)
    # NOTE: rework_pct is inflated for multi-feature iterations — it counts ALL
    # calls after first verify, including legitimate second-feature work.
    rework_vals = [e.get("rework_pct", 0) for e in entries]
    total_fix = sum(e.get("fix_cycles", 0) for e in entries)
    avg_rework = sum(rework_vals) / len(rework_vals) if rework_vals else 0
    re_vals = [e.get("return_edit_pct", 0) for e in entries]
    avg_re = sum(re_vals) / len(re_vals) if re_vals else 0
    # Consecutive zero-fix-cycle streak from end
    zero_streak = 0
    for e in reversed(entries):
        if e.get("fix_cycles", 0) == 0:
            zero_streak += 1
        else:
            break
    fix_note = ""
    if zero_streak >= ne and ne >= 5:
        fix_note = f" — 0 fix cycles in ALL {ne} iters (tests may not challenge impl)"
    elif zero_streak >= 5:
        fix_note = f" — 0 fix cycles last {zero_streak} iters"
    print(
        f"  Rework: {avg_rework:.0f}% post-verify overhead, "
        f"{total_fix} fix cycles total{fix_note}"
    )
    epf_vals = [e.get("edits_per_file", 0) for e in entries if e.get("edits_per_file", 0) > 0]
    avg_epf = sum(epf_vals) / len(epf_vals) if epf_vals else 0
    epf_warn = ""
    if avg_epf > 4:
        epf_warn = " — plan all changes per file before editing (see BUILDER_LESSONS)"
    elif avg_epf > 3:
        epf_warn = " — consider batching edits"
    print(
        f"  Re-edit: {avg_re:.0f}% avg, {avg_epf:.1f} edits/file avg"
        f"{epf_warn}"
    )
    # Verification breakdown: average runs per check type (>1 means reruns)
    vr_keys = ["typecheck", "test", "lint", "build"]
    vr_avgs = {}
    for k in vr_keys:
        vals = [e.get("verify_runs", {}).get(k, 0) for e in entries]
        vr_avgs[k] = sum(vals) / ne if ne else 0
    reruns = {k: v for k, v in vr_avgs.items() if v > 1.0}
    if reruns:
        parts = [f"{k} {v:.1f}×" for k, v in reruns.items()]
        print(f"  Verify reruns: {', '.join(parts)} avg/iter (>1× = rework)")
    else:
        parts = [f"{k} {v:.1f}×" for k, v in vr_avgs.items() if v > 0]
        if parts:
            print(f"  Verify runs: {', '.join(parts)} avg/iter")

    # Context size trend (per-turn cache read)
    if len(cpt_values) >= 2:
        first_half = sum(cpt_values[: len(cpt_values) // 2]) / (len(cpt_values) // 2)
        second_half = sum(cpt_values[len(cpt_values) // 2 :]) / (
            len(cpt_values) - len(cpt_values) // 2
        )
        delta_pct = (second_half - first_half) / first_half * 100 if first_half else 0
        if abs(delta_pct) < 3:
            direction = "stable"
        elif delta_pct > 0:
            direction = f"growing (+{delta_pct:.0f}%)"
        else:
            direction = f"shrinking ({delta_pct:.0f}%)"
        avg_cpt = sum(cpt_values) / len(cpt_values)
        print(f"  Context/turn: {avg_cpt // 1000}k avg, {direction}")

    # Subsystem distribution and streak detection
    sub_ctr = Counter(e.get("subsystem", "?") for e in entries)
    sub_str = ", ".join(f"{v} {k}" for k, v in sub_ctr.most_common())
    # Detect trailing streak (consecutive same-subsystem at the end)
    trail_sub = entries[-1].get("subsystem", "?") if entries else "?"
    trail_streak = 0
    for e in reversed(entries):
        if e.get("subsystem", "?") == trail_sub:
            trail_streak += 1
        else:
            break
    streak_warn = ""
    if trail_streak >= 3:
        streak_warn = f" — {trail_sub} × {trail_streak} STREAK (diminishing returns)"
    elif trail_streak == 2:
        streak_warn = f" — {trail_sub} × {trail_streak} (watch for saturation)"
    print(f"  Subsystems: {sub_str}{streak_warn}")

    # Domain-level concentration (coarser than subsystem — catches drift
    # across related subsystems like tools/orch → tools/routing → tools)
    dom_ctr = Counter(e.get("domain", "other") for e in entries)
    dom_str = ", ".join(f"{v} {k}" for k, v in dom_ctr.most_common())
    # Domain concentration warning: if any domain has >50% of iterations
    dom_warn = ""
    for dom, cnt in dom_ctr.most_common(1):
        if ne >= 4 and cnt >= ne * 0.6:
            dom_warn = (
                f" — {dom} domain: {cnt}/{ne} iters "
                f"CONCENTRATED (explore other domains)"
            )
        elif ne >= 4 and cnt >= ne * 0.5:
            dom_warn = f" — {dom} domain: {cnt}/{ne} iters (nearing saturation)"
    print(f"  Domains: {dom_str}{dom_warn}")

    # Work-type distribution with Shannon entropy diversity metric
    type_ctr = Counter(e.get("work_type", "?") for e in entries)
    type_str = ", ".join(f"{v} {k}" for k, v in type_ctr.most_common())
    type_warn = ""
    # Shannon entropy: H = -Σ p*log(p). Max for 3 types = ln(3) ≈ 1.10.
    # Below 60% of max → concentrated. (arxiv 2511.15593: diversity correlates
    # with agent performance)
    import math
    if ne >= 4:
        probs = [cnt / ne for cnt in type_ctr.values()]
        entropy = -sum(p * math.log(p) for p in probs if p > 0)
        max_entropy = math.log(3)  # 3 work types: feature, architecture, hardening
        diversity = entropy / max_entropy if max_entropy > 0 else 0
        if diversity < 0.3:
            type_warn = f" — diversity {diversity:.0%} LOW (strongly concentrated)"
        elif diversity < 0.6:
            type_warn = f" — diversity {diversity:.0%} (moderately concentrated)"
        else:
            type_warn = f" — diversity {diversity:.0%} (healthy)"
    print(f"  Work pattern: {type_str}{type_warn}")

    # Severity assessment
    sev_ctr = Counter(e["severity"] for e in entries if e["severity"] != "?")
    sev_str = ", ".join(f"{v} {k}" for k, v in sev_ctr.most_common())
    all_med = all(s in ("medium", "low") for s in sev_ctr)
    note = " (diminishing?)" if all_med and sev_ctr else ""
    print(f"  Severity: {sev_str}{note}")

    # Approach rotation
    apps = [e["approach"] for e in entries if e["approach"]]
    consec = any(apps[i] == apps[i + 1] for i in range(len(apps) - 1))
    rot = "CONSECUTIVE REPEAT" if consec else "ok (no repeats)"
    print(f"  Rotation: {rot}")

    # Mutation check compliance (added iter 502, tracked from iter 504)
    mut_ran = sum(1 for e in entries if e.get("mutation") == "ran")
    mut_total = len(entries)
    if mut_ran > 0 or any(e.get("mutation") for e in entries):
        print(f"  Mutation check: {mut_ran}/{mut_total} ran")

    # Web research usage — show volume, not just presence
    total_research = sum(e.get("research_calls", 0) for e in entries)
    web_iters = sum(1 for e in entries if e.get("web_research"))
    avg_rc = total_research / web_iters if web_iters else 0
    print(
        f"  Web research: {web_iters}/{ne} iterations, "
        f"{total_research} calls ({avg_rc:.0f}/iter avg)"
    )

    # DESIGN.md health check
    from pathlib import Path
    design_path = Path(__file__).parent / "DESIGN.md"
    if design_path.exists():
        design_lines = sum(1 for _ in design_path.open())
        design_limit = 1100
        if design_lines > design_limit:
            pct_over = (design_lines - design_limit) * 100 // design_limit
            print(
                f"  DESIGN.md: {design_lines} lines "
                f"(limit: {design_limit}, +{pct_over}% over — condense stable sections)"
            )
        else:
            print(f"  DESIGN.md: {design_lines} lines (limit: {design_limit}, ok)")

    # Depth phase health (from depth-log.md + auto-detected session activity)
    # Extract module-level activity from session edited files so depth
    # tracking doesn't depend solely on manual depth-log.md updates.
    session_module_activity: dict[str, int] = {}
    for e in entries:
        for fp in e.get("edited_files", set()):
            m = re.search(r"/src/(.+\.ts)$", fp)
            if not m:
                continue
            rel = m.group(1)
            # Map test files to their source module
            rel = re.sub(r"\.integration\.test\.ts$", ".ts", rel)
            rel = re.sub(r"\.test\.ts$", ".ts", rel)
            cur = session_module_activity.get(rel)
            if cur is None or e["iter"] > cur:
                session_module_activity[rel] = e["iter"]
    health = _depth_health(depth_rows, session_activity=session_module_activity)
    if health:
        h = health
        print(
            f"  Depth coverage: {h['distinct_modules']}/{h['total_big']} modules, "
            f"{h['stale']} stale, "
            f"{h['untried']}/{h['total_combos']} approach combos untried"
        )
        if h.get("top_neglected"):
            parts = []
            for path, last_iter, lines in h["top_neglected"]:
                if last_iter is None:
                    parts.append(f"{path} (NEVER, {lines}L)")
                else:
                    parts.append(f"{path} (iter {last_iter}, {lines}L)")
            print(f"  Top neglected: {', '.join(parts)}")
        if h["unknown_approaches"]:
            print(
                f"  WARNING: depth-log has approaches not in parse-log.py: "
                f"{', '.join(sorted(h['unknown_approaches']))}"
            )
    print()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--trend":
        n = int(sys.argv[2]) if len(sys.argv) >= 3 else 5
        trend(n)
    elif len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <session-log.jsonl>", file=sys.stderr)
        print(f"       {sys.argv[0]} --trend [N]", file=sys.stderr)
        sys.exit(1)
    else:
        parse(sys.argv[1])
