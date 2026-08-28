import os, sys
from collections import defaultdict

def count_lines(filepath):
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            return sum(1 for _ in f)
    except Exception:
        return 0

def is_test_file(path):
    f = os.path.basename(path)
    if f.endswith((".test.ts", ".test.tsx", ".test.js", ".test.mjs")) or f.endswith("Tests.swift"):
        return True
    return False

def is_test_support_file(path):
    if is_test_file(path):
        return False
    f = os.path.basename(path)
    if path.startswith("test/") or path == "test":
        return True
    support_suffixes = (
        "test-support.ts", "test-support.js", "test-helpers.ts", "test-helpers.js",
        "test-fixture.ts", "test-fixtures.ts", "fixture.ts", "fixtures.ts",
        "-fixture.ts", "-fixtures.ts", ".integration-test-helpers.ts",
        "test-support.integration.ts", "test-fixture.integration.ts"
    )
    if any(f.endswith(s) for s in support_suffixes):
        return True
    if ("fixtures" in path or "__fixtures__" in path) and not path.endswith("initial"):
        return True
    return False

def classify_family(path):
    if path.startswith("src/core/"):
        sub = path.split("/")[2]
        return "core/" + sub
    elif path.startswith("src/modules/"):
        sub = path.split("/")[2]
        return "modules/" + sub
    elif path.startswith("src/"):
        return "src/root-integration"
    elif path.startswith("clients/web/"):
        return "clients/web"
    elif path.startswith("clients/mobile/"):
        return "clients/mobile"
    elif path.startswith("clients/apple/"):
        return "clients/apple"
    return "other"

def main():
    root_dir = "."
    test_files = []
    support_files = []
    exclusions = {
        "eval_harness_initial_snapshots": [],
        "generated_daemon_client_bindings": [],
        "generated_schemas": [],
    }

    for root, dirs, files in os.walk(root_dir):
        if "node_modules" in root or ".kota" in root or "dist" in root:
            continue
        for f in files:
            p = os.path.normpath(os.path.join(root, f))
            if p.startswith("./"):
                p = p[2:]
            
            if "src/modules/eval-harness/fixtures" in p and "/initial" in p:
                exclusions["eval_harness_initial_snapshots"].append((p, count_lines(p)))
                continue
            if "clients/mobile/src/daemon" in p:
                exclusions["generated_daemon_client_bindings"].append((p, count_lines(p)))
                continue
            if p.startswith("schema/") and f.endswith(".json"):
                exclusions["generated_schemas"].append((p, count_lines(p)))
                continue

            if is_test_file(p):
                test_files.append((p, count_lines(p)))
            elif is_test_support_file(p):
                support_files.append((p, count_lines(p)))

    test_files.sort(key=lambda x: x[1], reverse=True)
    support_files.sort(key=lambda x: x[1], reverse=True)

    total_test_loc = sum(x[1] for x in test_files)
    total_support_loc = sum(x[1] for x in support_files)

    print("=" * 70)
    print("KOTA LEAN BEHAVIORAL VERIFICATION PROGRAM - BASELINE AUDIT REPORT")
    print("=" * 70)
    print(f"Total Executable Test Files:         {len(test_files):6d}")
    print(f"Total Executable Test LOC:           {total_test_loc:6d}")
    print(f"Total Authored Test-Support Files:   {len(support_files):6d}")
    print(f"Total Authored Test-Support LOC:     {total_support_loc:6d}")
    print("-" * 70)
    print("EXCLUSIONS (Generated / Vendored):")
    for k, v in exclusions.items():
        print(f"  {k:35s}: {len(v):4d} files, {sum(x[1] for x in v):6d} LOC")
    total_excl_files = sum(len(v) for v in exclusions.values())
    total_excl_loc = sum(sum(x[1] for x in v) for v in exclusions.values())
    print(f"  TOTAL EXCLUSIONS:                   {total_excl_files:4d} files, {total_excl_loc:6d} LOC")
    print("-" * 70)

    families = defaultdict(lambda: {"files": 0, "loc": 0, "test_files": []})
    for p, lines in test_files:
        fam = classify_family(p)
        families[fam]["files"] += 1
        families[fam]["loc"] += lines
        families[fam]["test_files"].append((p, lines))

    sorted_families = sorted(families.items(), key=lambda x: x[1]["loc"], reverse=True)
    print(f"TEST FAMILIES SUMMARY ({len(sorted_families)} families):")
    for name, data in sorted_families:
        print(f"  {name:35s}: {data["files"]:4d} files, {data["loc"]:6d} LOC")

    large_test_files = [x for x in test_files if x[1] > 500]
    large_support_files = [x for x in support_files if x[1] > 500]
    print("-" * 70)
    print(f"LARGE TEST FILES (> 500 LOC): {len(large_test_files)}")
    for p, lines in large_test_files:
        print(f"  {lines:6d}  {p}")
    print(f"LARGE SUPPORT FILES (> 500 LOC): {len(large_support_files)}")
    for p, lines in large_support_files:
        print(f"  {lines:6d}  {p}")

if __name__ == "__main__":
    main()
