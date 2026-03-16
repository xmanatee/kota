#!/usr/bin/env python3
"""Extract structured data from a Claude Code session log (.session.jsonl).

Usage:
    python3 parse-log.py <session-log-path>
    python3 parse-log.py logs/000433-build-agent-*.session.jsonl

Outputs a concise summary: stats, tool-call sequence, tool counts, errors,
key assistant text blocks, and (for depth builder iterations) an automated
execution analysis — everything the improver needs to assess a builder
iteration without manually parsing JSON.
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
    text_blocks: list[str] = []

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
                elif block.get("type") == "text" and block.get("text", "").strip():
                    text = block["text"].strip()
                    if len(text) > 30:
                        text_blocks.append(text[:300])

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
        _print_builder_analysis(tool_calls, text_blocks)


# --- Files that are documentation, not implementation ---
_DOC_FILES = {"changelog.md", "depth-log.md", "notes.md", "design.md"}

DEPTH_APPROACHES = [
    "audit", "friction", "harden", "e2e", "error-paths",
    "structural-health", "concurrency",
]


def _searchable(tc: ToolCall) -> str:
    """Combined lowercase string for keyword matching."""
    return f"{tc.detail} {tc.command} {tc.file_path}".lower()


def _is_doc_edit(tc: ToolCall) -> bool:
    """True if this Edit targets a documentation file."""
    fp = (tc.file_path or tc.detail).lower()
    return any(fp.endswith(d) for d in _DOC_FILES)


def _print_builder_analysis(
    tool_calls: list[ToolCall],
    text_blocks: list[str],
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

    # 5. Sweep: Grep calls after first implementation Edit
    #    (captures sweep searches that may precede sweep-fix Edits)
    post_greps = 0
    if first_impl_edit is not None:
        for tc in tool_calls[first_impl_edit + 1:]:
            if tc.name == "Grep":
                post_greps += 1
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

    # 7. Test delta from key text
    test_delta = None
    for text in text_blocks:
        m = re.search(r"(\d+)\s*(?:→|->)+\s*(\d+)", text)
        if m:
            before, after = int(m.group(1)), int(m.group(2))
            if 0 < after - before < 200:
                test_delta = f"{before}→{after} (+{after - before})"
                break
        m = re.search(r"\+(\d+)\s*(?:new\s+)?tests?", text, re.I)
        if m and not test_delta:
            test_delta = f"+{m.group(1)}"
            break
        m = re.search(r"(\d+)\s+new\s+(?:edge.case\s+)?tests?", text, re.I)
        if m and not test_delta:
            test_delta = f"+{m.group(1)}"
            break
    print(f"  Test delta:   {test_delta or '?'}")
    print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <session-log.jsonl>", file=sys.stderr)
        sys.exit(1)
    parse(sys.argv[1])
