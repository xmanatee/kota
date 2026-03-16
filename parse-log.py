#!/usr/bin/env python3
"""Extract structured data from a Claude Code session log (.session.jsonl).

Usage:
    python3 parse-log.py <session-log-path>
    python3 parse-log.py logs/000433-build-agent-*.session.jsonl

Outputs a concise summary: stats, tool-call sequence, tool counts, errors,
and key assistant text blocks — everything the improver needs to assess a
builder iteration without manually parsing JSON.
"""

import json
import sys
from collections import Counter
from pathlib import Path


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

    # --- Tool call sequence ---
    tool_calls = []
    tool_counts = Counter()
    errors = []
    text_blocks = []

    for msg in messages:
        if msg.get("type") != "assistant":
            continue
        content = msg.get("message", {}).get("content", [])
        for block in content:
            if block.get("type") == "tool_use":
                name = block["name"]
                inp = block.get("input", {})
                desc = inp.get("description", "")
                # For Read, show file_path; for Bash, show command snippet
                detail = desc
                if not detail:
                    if "file_path" in inp:
                        detail = inp["file_path"].split("/")[-1]
                    elif "command" in inp:
                        detail = inp["command"][:80]
                    elif "prompt" in inp:
                        detail = inp["prompt"][:80]
                tool_calls.append((name, detail))
                tool_counts[name] += 1

            elif block.get("type") == "text" and block.get("text", "").strip():
                text = block["text"].strip()
                # Keep meaningful text blocks (skip very short ones)
                if len(text) > 30:
                    text_blocks.append(text[:300])

    # --- Tool call sequence ---
    print(f"=== Tool Call Sequence ({len(tool_calls)} calls) ===")
    for i, (name, detail) in enumerate(tool_calls, 1):
        print(f"  {i:3d}. {name:12s} | {detail[:90]}")
    print()

    # --- Tool counts ---
    print("=== Tool Counts ===")
    for name, count in tool_counts.most_common():
        print(f"  {name:12s}: {count}")
    print()

    # --- Errors (from tool results) ---
    for msg in messages:
        if msg.get("type") != "user":
            continue
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

    if errors:
        print(f"=== Errors ({len(errors)}) ===")
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}")
        print()

    # --- Key text blocks ---
    print(f"=== Key Assistant Text ({len(text_blocks)} blocks) ===")
    for i, text in enumerate(text_blocks, 1):
        # Truncate for readability
        display = text.replace("\n", " \\n ")[:200]
        print(f"  {i:3d}. {display}")
    print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <session-log.jsonl>", file=sys.stderr)
        sys.exit(1)
    parse(sys.argv[1])
