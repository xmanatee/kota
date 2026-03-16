#!/usr/bin/env python3
"""Regenerate depth-log.md derived sections from the main table + filesystem.

Preserves: header, main table, stale coverage notes (manually maintained).
Regenerates: approach summary, uncovered modules list, coverage matrix,
severity distribution.

Usage:
    python3 refresh-depth-log.py          # update depth-log.md in place
    python3 refresh-depth-log.py --dry    # print to stdout instead
"""

import re
import sys
from collections import Counter
from pathlib import Path

DIR = Path(__file__).parent
SRC = DIR / "src"
DEPTH_LOG = DIR / "depth-log.md"
MIN_LINES = 200  # threshold for uncovered/coverage tracking


def parse_main_table(text: str) -> list[dict]:
    rows = []
    for line in text.split("\n"):
        m = re.match(
            r"\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*(\S+)\s*\|\s*(.+?)\s*\|",
            line,
        )
        if m and m.group(1).isdigit():
            rows.append({
                "iter": int(m.group(1)),
                "approach": m.group(2).strip(),
                "modules": [mod.strip() for mod in m.group(3).split(",")],
                "severity": m.group(4).strip(),
                "summary": m.group(5).strip(),
            })
    return rows


def get_source_files() -> dict[str, int]:
    """Non-test .ts files under src/, keyed by path relative to src/."""
    files = {}
    for subdir in [SRC, SRC / "tools", SRC / "modules"]:
        if not subdir.exists():
            continue
        for f in subdir.glob("*.ts"):
            if ".test." in f.name or ".integration." in f.name:
                continue
            rel = str(f.relative_to(SRC))
            files[rel] = sum(1 for _ in f.open())
    return files


def get_test_files() -> dict[str, int]:
    """Test file line counts, keyed by corresponding source path relative to src/."""
    tests = {}
    for subdir in [SRC, SRC / "tools", SRC / "modules"]:
        if not subdir.exists():
            continue
        for f in subdir.glob("*.test.ts"):
            source_name = f.name.replace(".test.", ".")
            rel = str((f.parent / source_name).relative_to(SRC))
            tests[rel] = sum(1 for _ in f.open())
    return tests


def resolve_module(name: str, files: dict[str, int]) -> list[str]:
    """Resolve a main-table module name to actual file path(s) relative to src/."""
    if "*" in name:
        prefix = name.replace("*.ts", "").rstrip("/")
        return [f for f in files if f.startswith(prefix + "/")]
    if name in files:
        return [name]
    for prefix in ["", "tools/", "modules/"]:
        candidate = prefix + name
        if candidate in files:
            return [candidate]
    return []


def extract_section(text: str, heading_prefix: str) -> str:
    """Extract a markdown section (heading through next ## or EOF)."""
    lines = text.split("\n")
    start = None
    for i, line in enumerate(lines):
        if line.strip().startswith(heading_prefix):
            start = i
        elif start is not None and line.startswith("## "):
            return "\n".join(lines[start:i]).rstrip()
    return "\n".join(lines[start:]).rstrip() if start is not None else ""


def header_and_table(text: str) -> str:
    """Extract everything up to and including the main table + one blank line."""
    lines = text.split("\n")
    result = []
    in_table = False
    for line in lines:
        if line.startswith("| Iter"):
            in_table = True
        if in_table and not line.startswith("|"):
            result.append("")
            break
        result.append(line)
    return "\n".join(result)


def main():
    dry = "--dry" in sys.argv
    text = DEPTH_LOG.read_text()
    rows = parse_main_table(text)
    files = get_source_files()
    tests = get_test_files()

    if not rows:
        print("ERROR: no rows in main table", file=sys.stderr)
        sys.exit(1)

    # Build coverage map
    covered: dict[str, list[tuple[int, str]]] = {}
    for row in rows:
        for mod_name in row["modules"]:
            for path in resolve_module(mod_name, files):
                covered.setdefault(path, []).append((row["iter"], row["approach"]))

    # Uncovered modules (≥MIN_LINES, not covered)
    uncovered = [
        (p, n) for p, n in sorted(files.items(), key=lambda x: -x[1])
        if n >= MIN_LINES and p not in covered
    ]

    # Coverage matrix (covered modules still in filesystem)
    matrix = []
    for path in sorted(covered, key=lambda p: -(files.get(p, 0))):
        if path not in files:
            continue
        iters = ",".join(str(i) for i, _ in covered[path])
        approaches = ", ".join(a for _, a in covered[path])
        matrix.append((path, files[path], iters, approaches))

    # Severity distribution
    sev = Counter(r["severity"] for r in rows)
    total = len(rows)
    max_iter = max(r["iter"] for r in rows)
    sev_str = ", ".join(f"{k}={v}" for k, v in sorted(sev.items()))

    # Approach summary (count + last-used iter per approach)
    approach_count: dict[str, int] = Counter()
    approach_last: dict[str, int] = {}
    for row in rows:
        a = row["approach"]
        approach_count[a] += 1
        approach_last[a] = max(approach_last.get(a, 0), row["iter"])
    approach_sorted = sorted(
        approach_count.keys(),
        key=lambda a: (-approach_count[a], -approach_last[a]),
    )

    # Preserve stale section
    stale = extract_section(text, "## Stale Coverage")

    # --- Build output ---
    out = [header_and_table(text)]

    # Approach summary
    out.append("## Approach Summary\n")
    out.append("| Approach | Count | Last Used |")
    out.append("|----------|-------|-----------|")
    for a in approach_sorted:
        out.append(f"| {a} | {approach_count[a]} | {approach_last[a]} |")
    out.append(f"\n{total} depth iterations across {len(approach_sorted)} approaches.")
    out.append("")

    # Uncovered
    out.append("## Uncovered Modules — PRIMARY Targets\n")
    out.append(
        "These modules have **zero depth iterations**. They are blind spots — no one has\n"
        "examined their error handling, edge cases, integration seams, or structural\n"
        "health. Prioritize these over already-covered modules.\n"
    )
    out.append(
        "**Test Lines** = existing breadth-phase test coverage. Modules with 0 test\n"
        "lines are the highest-risk blind spots.\n"
    )
    if uncovered:
        out.append("| Module | Lines | Test Lines |")
        out.append("|--------|-------|------------|")
        for path, lines in uncovered:
            tl = tests.get(path, 0)
            out.append(f"| {path} | {lines} | {tl} |")
        total_lines = sum(n for _, n in uncovered)
        zero_test = sum(1 for p, _ in uncovered if tests.get(p, 0) == 0)
        out.append(f"\n**{len(uncovered)} uncovered modules, {total_lines:,} lines total"
                   f" ({zero_test} with zero tests).**")
    else:
        out.append("*All modules ≥200 lines have depth coverage.*")

    # Stale (preserved)
    out.append("")
    out.append(stale if stale else (
        "## Stale Coverage — SECONDARY Targets\n\n"
        "*Maintained by the improver — builder only appends rows to the main table above.*\n\n"
        "(No stale coverage notes yet.)"
    ))

    # Coverage matrix
    out.append("")
    out.append("## Coverage by Module\n")
    out.append("Reference data — see uncovered and stale sections above for targeting guidance.\n")
    out.append("| Module | Lines | Test Lines | Depth Iters | Approaches Applied |")
    out.append("|--------|-------|------------|-------------|---------------------|")
    for path, lines, iters, approaches in matrix:
        tl = tests.get(path, 0)
        out.append(f"| {path} | {lines} | {tl} | {iters} | {approaches} |")
    out.append(f"\nData refreshed at iter {max_iter + 1}. Previous refresh at iter {max_iter}.")

    # Severity key
    out.append("")
    out.append("## Severity Key\n")
    out.append("*Maintained by the improver.*\n")
    out.append("- **critical** — Security vulnerability, process crash/hang, data loss")
    out.append("- **high** — Broken normal-use functionality, silent failures")
    out.append("- **medium** — Edge-case UX issues, confusing errors (functional workaround exists)")
    out.append(f"\nDistribution ({total} iterations): {sev_str}")
    out.append("")

    result = "\n".join(out)
    if dry:
        print(result)
    else:
        DEPTH_LOG.write_text(result)

    # Summary
    dest = "stdout" if dry else "depth-log.md"
    print(f"Refreshed {dest}:", file=sys.stderr)
    print(f"  {len(rows)} depth iterations in main table", file=sys.stderr)
    print(f"  {len(uncovered)} uncovered modules ({sum(n for _, n in uncovered):,} lines)", file=sys.stderr)
    print(f"  {len(matrix)} covered modules in matrix", file=sys.stderr)
    print(f"  Severity: {sev_str}", file=sys.stderr)
    print(f"  Approaches: {', '.join(f'{a}={approach_count[a]}' for a in approach_sorted)}", file=sys.stderr)


if __name__ == "__main__":
    main()
