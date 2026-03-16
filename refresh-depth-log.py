#!/usr/bin/env python3
"""Regenerate depth-log.md derived sections from the main table + filesystem.

Preserves: header, main table.
Regenerates: approach summary, uncovered modules list, stale coverage list,
coverage matrix, severity distribution.

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
STALE_THRESHOLD = 10  # builder iterations since last depth coverage

# Modules excluded from depth targeting (uncovered + stale lists).
# These contain no server-side logic testable with Node.js unit tests.
DEPTH_EXCLUDE = {
    "web-ui-client.ts",   # browser JS template literal — DOM manipulation, no server logic
    "web-ui-styles.ts",   # CSS template literal — styling only, no testable logic
}

# Canonical list of all depth approaches — must match the builder prompt.
# Approaches with 0 uses still appear in the summary and gap matrix so the
# builder can see them as options.
ALL_APPROACHES = [
    "audit",
    "friction",
    "harden",
    "structural-health",
    "e2e",
    "error-paths",
    "concurrency",
    "resource-lifecycle",
]


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

    # Uncovered modules (≥MIN_LINES, not covered, not excluded)
    uncovered = [
        (p, n) for p, n in sorted(files.items(), key=lambda x: -x[1])
        if n >= MIN_LINES and p not in covered and p not in DEPTH_EXCLUDE
    ]
    excluded = [
        (p, files[p]) for p in sorted(DEPTH_EXCLUDE) if p in files
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
    # Include ALL canonical approaches (even unused ones with count=0)
    all_known = set(ALL_APPROACHES) | set(approach_count.keys())
    approach_sorted = sorted(
        all_known,
        key=lambda a: (-approach_count.get(a, 0), -approach_last.get(a, 0)),
    )
    # Rotation: last 2 builder iterations' approaches are blocked
    builder_rows = sorted(rows, key=lambda r: r["iter"])
    last_2_builder_approaches = set()
    for r in builder_rows[-2:]:
        last_2_builder_approaches.add(r["approach"])
    rotation_eligible = [a for a in approach_sorted if a not in last_2_builder_approaches]
    rotation_blocked = [a for a in approach_sorted if a in last_2_builder_approaches]

    # Stale coverage detection (auto-generated)
    stale_modules = []
    stale_approach_map: dict[str, dict[str, list[int]]] = {}
    for path in sorted(covered, key=lambda p: -(files.get(p, 0))):
        if path not in files or files[path] < MIN_LINES or path in DEPTH_EXCLUDE:
            continue
        last_cov_iter = max(i for i, _ in covered[path])
        builder_iters_ago = (max_iter - last_cov_iter) // 2
        if builder_iters_ago >= STALE_THRESHOLD:
            tl = tests.get(path, 0)
            unique_approaches = len(set(a for _, a in covered[path]))
            approaches_used = ", ".join(a for _, a in covered[path])
            stale_modules.append((path, files[path], tl, last_cov_iter, builder_iters_ago, unique_approaches, approaches_used))
            # Build approach map for gap matrix
            stale_approach_map[path] = {}
            for it, appr in covered[path]:
                stale_approach_map[path].setdefault(appr, []).append(it)
    # Sort by: staleness desc > unique approaches asc > lines desc
    # This ensures under-explored modules get priority over well-examined ones
    # when staleness is similar.
    stale_modules.sort(key=lambda x: (-x[4], x[5], -x[1]))

    # --- Build output ---
    out = [header_and_table(text)]

    # Approach summary
    out.append("## Approach Summary\n")
    out.append("| Approach | Count | Last Used | Rotation |")
    out.append("|----------|-------|-----------|----------|")
    for a in approach_sorted:
        count = approach_count.get(a, 0)
        last = approach_last.get(a, 0)
        last_str = str(last) if last else "—"
        status = "BLOCKED" if a in last_2_builder_approaches else "eligible"
        out.append(f"| {a} | {count} | {last_str} | {status} |")
    out.append(f"\n{total} depth iterations across {len(approach_sorted)} approaches.")
    blocked_str = ", ".join(rotation_blocked)
    eligible_str = ", ".join(rotation_eligible)
    out.append(f"**Rotation blocked** (used in last 2 builder iters): {blocked_str}")
    out.append(f"**Rotation eligible**: {eligible_str}")
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

    if excluded:
        names = ", ".join(f"`{p}`" for p, _ in excluded)
        out.append(f"\n*Excluded from depth targeting (view-only template literals): {names}.*")

    # Stale coverage (auto-generated)
    out.append("")
    if uncovered:
        out.append("## Stale Coverage — SECONDARY Targets\n")
        out.append(
            f"*Auto-generated. Covered modules (≥{MIN_LINES} lines) whose last depth coverage\n"
            f"was ≥{STALE_THRESHOLD} builder iterations ago. Consider after exhausting uncovered modules.*\n"
        )
    else:
        out.append("## Stale Coverage — PRIMARY Targets\n")
        out.append(
            f"*Auto-generated. All modules have initial depth coverage — stale modules are now\n"
            f"your primary targets. Covered modules (≥{MIN_LINES} lines) whose last depth coverage\n"
            f"was ≥{STALE_THRESHOLD} builder iterations ago. Use the approach gap matrix below to\n"
            f"find untried module+approach combinations.*\n"
        )
    if stale_modules:
        out.append("| Module | Lines | Test Lines | Last Covered | Builder Iters Ago | Unique Approaches | Approaches Used |")
        out.append("|--------|-------|------------|--------------|-------------------|-------------------|-----------------|")
        for path, lines, tl, last_iter, staleness, uniq_app, approaches in stale_modules:
            out.append(f"| {path} | {lines} | {tl} | {last_iter} | {staleness} | {uniq_app} | {approaches} |")
        out.append(f"\n**{len(stale_modules)} stale modules.**")

        # Approach gap matrix for stale modules
        if len(stale_modules) > 0 and len(approach_sorted) > 0:
            out.append("")
            out.append("### Approach Gap Matrix\n")
            out.append(
                "*Which approaches have been tried on each stale module. "
                "`—` = untried, `BLOCKED` = not rotation-eligible.*\n"
            )
            # Header — use all canonical approaches
            cols = approach_sorted
            col_labels = []
            for c in cols:
                col_labels.append(f"~~{c}~~" if c in last_2_builder_approaches else c)
            header = "| Module | " + " | ".join(col_labels) + " |"
            sep = "|--------|" + "|".join("-" * (max(len(c), 3) + 4) for c in cols) + "|"
            out.append(header)
            out.append(sep)
            for path, *_ in stale_modules:
                cells = []
                for appr in cols:
                    iters = stale_approach_map.get(path, {}).get(appr, [])
                    if iters:
                        cells.append(",".join(str(i) for i in iters))
                    elif appr in last_2_builder_approaches:
                        cells.append("BLOCKED")
                    else:
                        cells.append("—")
                out.append(f"| {path} | " + " | ".join(cells) + " |")
            total_cells = len(stale_modules) * len(cols)
            filled = sum(
                1 for path, *_ in stale_modules
                for appr in cols
                if stale_approach_map.get(path, {}).get(appr)
            )
            out.append(f"\n**{total_cells - filled}/{total_cells} combinations untried.**")
    else:
        out.append("*No stale modules — all covered modules have recent depth coverage.*")

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
    excl_note = f" (+{len(excluded)} excluded)" if excluded else ""
    print(f"  {len(uncovered)} uncovered modules ({sum(n for _, n in uncovered):,} lines){excl_note}", file=sys.stderr)
    print(f"  {len(stale_modules)} stale modules (≥{STALE_THRESHOLD} builder iters since last coverage)", file=sys.stderr)
    print(f"  {len(matrix)} covered modules in matrix", file=sys.stderr)
    print(f"  Severity: {sev_str}", file=sys.stderr)
    print(f"  Approaches: {', '.join(f'{a}={approach_count.get(a, 0)}' for a in approach_sorted)}", file=sys.stderr)
    print(f"  Rotation blocked: {', '.join(rotation_blocked)}", file=sys.stderr)
    print(f"  Rotation eligible: {', '.join(rotation_eligible)}", file=sys.stderr)


if __name__ == "__main__":
    main()
