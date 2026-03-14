#!/usr/bin/env python3
"""Summarize a Claude Code session JSONL file into a readable markdown report.

Usage: python3 scripts/summarize-session.py <session.jsonl> [output.summary.md]

If output path is omitted, prints to stdout.
"""

import json
import sys
from collections import Counter
from pathlib import Path


def parse_session(path: str) -> dict:
    """Parse a session JSONL file and extract key events."""
    messages = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    messages.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    if not messages:
        return {"error": "Empty session log"}

    # Extract metadata from system message
    meta = {}
    if messages[0].get("type") == "system":
        meta["model"] = messages[0].get("model", "unknown")
        meta["session_id"] = messages[0].get("session_id", "unknown")

    # Extract result from last message
    result = {}
    for msg in reversed(messages):
        if msg.get("type") == "result":
            result = {
                "cost_usd": msg.get("total_cost_usd"),
                "num_turns": msg.get("num_turns"),
                "duration_ms": msg.get("duration_ms"),
                "duration_api_ms": msg.get("duration_api_ms"),
                "output_tokens": msg.get("usage", {}).get("output_tokens"),
                "input_tokens": msg.get("usage", {}).get("input_tokens"),
            }
            break

    # Count tool usage and collect key events
    tool_counts = Counter()
    tool_errors = []
    assistant_texts = []
    decisions = []
    files_edited = set()
    files_written = set()
    files_read = set()

    for msg in messages:
        if msg.get("type") != "assistant":
            continue
        content = msg.get("message", {}).get("content", [])
        for block in content:
            if block.get("type") == "text":
                text = block["text"].strip()
                if text:
                    assistant_texts.append(text)
                    # Heuristic: lines with "Decision:", "Rationale:", candidates
                    # table, or "Assessment" are key decision points
                    lower = text.lower()
                    if any(
                        kw in lower
                        for kw in [
                            "decision:",
                            "rationale:",
                            "candidate",
                            "assessment",
                            "i'll ",
                            "i will ",
                            "let me build",
                            "here's what",
                            "my plan",
                        ]
                    ):
                        decisions.append(text[:500])

            elif block.get("type") == "tool_use":
                name = block["name"]
                tool_counts[name] += 1
                inp = block.get("input", {})

                if name == "Edit":
                    fp = inp.get("file_path", "")
                    if fp:
                        files_edited.add(fp)
                elif name == "Write":
                    fp = inp.get("file_path", "")
                    if fp:
                        files_written.add(fp)
                elif name == "Read":
                    fp = inp.get("file_path", "")
                    if fp:
                        files_read.add(fp)

    # Check tool results for errors
    for msg in messages:
        if msg.get("type") == "tool_result":
            content = msg.get("message", {}).get("content", [])
            for block in content if isinstance(content, list) else []:
                if block.get("is_error"):
                    tool_errors.append(block.get("text", "")[:200])

    return {
        "meta": meta,
        "result": result,
        "tool_counts": dict(tool_counts.most_common()),
        "tool_total": sum(tool_counts.values()),
        "tool_errors": tool_errors,
        "decisions": decisions,
        "assistant_text_count": len(assistant_texts),
        "first_text": assistant_texts[0][:300] if assistant_texts else "",
        "last_text": assistant_texts[-1][:500] if assistant_texts else "",
        "files_edited": sorted(files_edited),
        "files_written": sorted(files_written),
        "files_read": sorted(files_read),
        "message_count": len(messages),
    }


def format_summary(data: dict, path: str) -> str:
    """Format parsed session data as readable markdown."""
    lines = []
    fname = Path(path).name

    lines.append(f"# Session Summary: {fname}")
    lines.append("")

    # Result metrics
    r = data.get("result", {})
    if r:
        cost = r.get("cost_usd")
        turns = r.get("num_turns")
        dur = r.get("duration_ms")
        out_tok = r.get("output_tokens")

        metrics = []
        if cost is not None:
            metrics.append(f"**Cost**: ${cost:.2f}")
        if turns is not None:
            metrics.append(f"**Turns**: {turns}")
        if dur is not None:
            metrics.append(f"**Duration**: {dur/1000:.0f}s")
        if out_tok is not None:
            metrics.append(f"**Output tokens**: {out_tok:,}")
        if metrics:
            lines.append("## Metrics")
            lines.append(", ".join(metrics))
            lines.append("")

    # Tool usage
    tc = data.get("tool_counts", {})
    if tc:
        lines.append("## Tool Usage")
        for name, count in tc.items():
            lines.append(f"- {name}: {count}")
        lines.append(f"- **Total**: {data.get('tool_total', 0)}")
        lines.append("")

    # Files modified
    edited = data.get("files_edited", [])
    written = data.get("files_written", [])
    if edited or written:
        lines.append("## Files Modified")
        for f in written:
            lines.append(f"- (new) {_short_path(f)}")
        for f in edited:
            lines.append(f"- (edit) {_short_path(f)}")
        lines.append("")

    # Key decisions
    decisions = data.get("decisions", [])
    if decisions:
        lines.append("## Key Decisions")
        for i, d in enumerate(decisions[:5]):
            lines.append(f"### Decision {i+1}")
            lines.append(d)
            lines.append("")

    # Errors
    errors = data.get("tool_errors", [])
    if errors:
        lines.append("## Errors")
        for e in errors:
            lines.append(f"- {e}")
        lines.append("")

    # Final output
    last = data.get("last_text", "")
    if last:
        lines.append("## Final Output")
        lines.append(last)
        lines.append("")

    return "\n".join(lines)


def _short_path(p: str) -> str:
    """Shorten a path to just the last 3 segments."""
    parts = Path(p).parts
    if len(parts) > 3:
        return "/".join(parts[-3:])
    return p


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <session.jsonl> [output.summary.md]")
        sys.exit(1)

    session_path = sys.argv[1]
    data = parse_session(session_path)

    if "error" in data:
        print(f"Error: {data['error']}", file=sys.stderr)
        sys.exit(1)

    summary = format_summary(data, session_path)

    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
        Path(output_path).write_text(summary)
        print(f"Summary written to {output_path}")
    else:
        print(summary)


if __name__ == "__main__":
    main()
