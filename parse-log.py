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

    # P2: "X→Y" within 60 chars of "test"
    for text in texts:
        for m in re.finditer(r"(\d+)\s*(?:→|->)\s*(\d+)", text):
            before, after = int(m.group(1)), int(m.group(2))
            if not (0 < after - before < 200):
                continue
            start = max(0, m.start() - 60)
            end = min(len(text), m.end() + 60)
            if "test" in text[start:end].lower():
                return f"{before}→{after} (+{after - before})"

    # P3: "+N tests" or "N new tests"
    for text in texts:
        m = re.search(r"\+\s*(\d+)\s*(?:new\s+)?tests?", text, re.I)
        if m:
            return f"+{m.group(1)}"
        m = re.search(r"(\d+)\s+new\s+(?:[\w-]+\s+)?tests?", text, re.I)
        if m:
            return f"+{m.group(1)}"

    # P4: Generic X→Y with plausible positive delta
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


def _print_builder_analysis(
    tool_calls: list[ToolCall],
    text_blocks: list[str],
    full_text_blocks: list[str] | None = None,
    changelog_edits: list[str] | None = None,
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
    if not is_depth:
        return

    print("=== Builder Execution Analysis (depth) ===")

    # 1. Refresh check — search both description and command
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

    # 2. Target extraction — structured format first, then fallback patterns
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
            # Match against canonical approach names (prefix match for
            # variants like "audit connections" → "audit")
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

    # 3. Pre-edit investigation: reads before first implementation edit
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

    # 4. Fix-verify cycles: edit -> test -> re-edit sequences
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
        if saw_test_after_edit and is_edit:
            cycles += 1
        if is_edit:
            saw_edit = True
            saw_test_after_edit = False
        elif is_test and saw_edit:
            saw_test_after_edit = True
            saw_edit = False
        elif not is_test:
            saw_edit = False

    print(f"  Fix-verify:   {cycles} cycle(s)")

    # 5. Sweep: total calls between mutation check and verification
    post_greps = 0
    if first_impl_edit is not None:
        for tc in tool_calls[first_impl_edit + 1:]:
            if tc.name == "Grep":
                post_greps += 1
    # Total sweep cost: all calls between mutation end and verification start
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

    # 6. Verification levels — check both description and command
    checks = {"typecheck": False, "build": False, "test": False, "load": False}
    for tc in tool_calls:
        if tc.name != "Bash":
            continue
        s = _searchable(tc)
        if "typecheck" in s or "tsc" in s:
            checks["typecheck"] = True
        if ("build" in s or "npm run build" in s) and "typecheck" not in s:
            checks["build"] = True
        if any(kw in s for kw in ["npm test", "vitest", "run test"]):
            checks["test"] = True
        if "cli.js" in s:
            checks["load"] = True
    status = "  ".join(
        f"{k} {'ok' if v else 'MISS'}" for k, v in checks.items()
    )
    print(f"  Verification: {status}")

    # 7. Test delta — search full-length text + CHANGELOG edits
    #    (truncated text_blocks miss deltas in long summary blocks)
    search_texts = (full_text_blocks or text_blocks) + (changelog_edits or [])
    test_delta = _extract_test_delta(search_texts)
    print(f"  Test delta:   {test_delta or '?'}")

    # 8. Source files edited (scope of changes)
    edited = sorted(set(
        (tc.file_path or tc.detail).split("/")[-1]
        for tc in tool_calls
        if tc.name == "Edit" and not _is_doc_edit(tc)
    ))
    if edited:
        print(f"  Files edited: {', '.join(edited)}")

    # 9. Mutation check — did the builder verify new tests catch the bug?
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
    text_snippets: list[str] = []
    full_texts: list[str] = []
    cl_edits: list[str] = []
    error_count = 0
    tc_list: list[tuple[str, str]] = []  # (name, searchable) for sweep
    for msg in messages:
        if msg.get("type") == "user":
            content = msg.get("message", {}).get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("is_error"):
                        error_count += 1
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
                if block["name"] == "Bash":
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
    work_type = "depth" if (target_mod and target_app) else "feature"

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
        "test_delta": _extract_test_delta(full_texts + cl_edits),
        "mutation": "ran" if mutation_calls > 0 else "no",
        "cache_read": cache_read,
        "cache_per_turn": round(cache_read / turns) if turns else 0,
        "error_count": error_count,
        "sweep_calls": sweep_calls,
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


def _depth_health(rows: list[dict]) -> dict:
    """Compute depth phase health metrics from main table rows."""
    if not rows:
        return {}
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

    max_iter = max(r["iter"] for r in rows)
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
            tried = len(set(a for _, a in covered[path]))
            tried_combos += tried
        else:
            total_combos += len(DEPTH_APPROACHES)
            tried = len(set(a for _, a in covered[path]))
            tried_combos += tried

    distinct_modules = len(set(p for p in covered if p in big_modules))
    # Approach sync check: compare DEPTH_APPROACHES against approaches in rows
    log_approaches = set(r["approach"] for r in rows)
    known_set = set(DEPTH_APPROACHES)
    unknown = log_approaches - known_set
    return {
        "total_iters": len(rows),
        "distinct_modules": distinct_modules,
        "total_big": len(big_modules),
        "stale": stale_count,
        "untried": total_combos - tried_combos,
        "total_combos": total_combos,
        "unknown_approaches": unknown,
    }


def trend(n: int = 5) -> None:
    """Cross-session trend of the last N builder iterations."""
    logs = _find_builder_logs(n)
    if not logs:
        print("No builder session logs found.")
        return
    sevs, depth_rows = _load_depth_log()
    entries = []
    for iter_num, path in reversed(logs):  # chronological order
        data = _quick_parse(path)
        data["iter"] = iter_num
        data["severity"] = sevs.get(iter_num, "?")
        entries.append(data)

    print(f"=== Builder Trend (last {len(entries)}) ===")
    total_calls = total_tests = test_count = 0
    total_cost = 0.0
    cpt_values: list[int] = []
    for e in entries:
        mod = e["module"] or "?"
        if "/" in mod:
            mod = mod.split("/")[-1]
        app = e["approach"] or "?"
        sev = e["severity"]
        td = e["test_delta"] or "?"
        cpt = e.get("cache_per_turn", 0)
        cpt_str = f"{cpt // 1000}k" if cpt else "?"
        errs = e.get("error_count", 0)
        sweep = e.get("sweep_calls", 0)
        print(
            f"  {e['iter']}  {mod:<22s} {app:<18s} {sev:<9s}"
            f" {e['calls']:>3d} calls  ${e['cost']:.2f}  tests: {td}"
            f"  ctx: {cpt_str}/turn  errs: {errs}  sweep: {sweep}"
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

    # Work-type distribution and dominance signal
    type_ctr = Counter(e.get("work_type", "?") for e in entries)
    type_str = ", ".join(f"{v} {k}" for k, v in type_ctr.most_common())
    # Compute longest consecutive run of the dominant type
    dominant = type_ctr.most_common(1)[0][0] if type_ctr else "?"
    max_run = cur_run = 0
    for e in entries:
        if e.get("work_type", "?") == dominant:
            cur_run += 1
            max_run = max(max_run, cur_run)
        else:
            cur_run = 0
    dom_note = ""
    dom_count = type_ctr.get(dominant, 0)
    if ne >= 5 and dom_count / ne >= 0.8:
        dom_note = f" — {dominant} dominant ({dom_count}/{ne})"
    print(f"  Work pattern: {type_str}{dom_note}")

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

    # Depth phase health (from depth-log.md)
    health = _depth_health(depth_rows)
    if health:
        h = health
        print(
            f"  Depth coverage: {h['distinct_modules']}/{h['total_big']} modules, "
            f"{h['stale']} stale, "
            f"{h['untried']}/{h['total_combos']} approach combos untried"
        )
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
