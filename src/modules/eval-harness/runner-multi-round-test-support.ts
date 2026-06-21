import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeMultiRoundFixture(fixturesRoot: string, id = "multi-round-mini"): void {
  const fixtureDir = join(fixturesRoot, id);
  mkdirSync(join(fixtureDir, "initial", "state"), { recursive: true });
  mkdirSync(join(fixtureDir, "rounds"), { recursive: true });
  writeFileSync(join(fixtureDir, "initial", "state", "seed.txt"), "seed");
  writeFileSync(join(fixtureDir, "rounds", "round-2-task.md"), "round 2 task");
  writeFileSync(
    join(fixtureDir, "fixture.json"),
    JSON.stringify({
      id,
      description: "multi-round fixture",
      role: "builder",
      mode: "multi-round",
      rounds: [
        {
          id: "round-1",
          workflowName: "builder",
          budgetMs: 60_000,
          taskInput: { kind: "initial-state" },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "state/round-1.txt" }, expected: "fail" },
          ],
          predicates: [{ kind: "file-exists", path: "state/round-1.txt" }],
        },
        {
          id: "round-2",
          workflowName: "builder",
          budgetMs: 70_000,
          taskInput: {
            kind: "copy-fixture-file",
            sourcePath: "rounds/round-2-task.md",
            targetPath: "data/tasks/ready/task-round-2.md",
          },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "state/round-1.txt" }, expected: "pass" },
            { predicate: { kind: "file-exists", path: "data/tasks/ready/task-round-2.md" }, expected: "pass" },
            { predicate: { kind: "file-exists", path: "state/round-2.txt" }, expected: "fail" },
          ],
          predicates: [
            { kind: "file-exists", path: "state/round-1.txt" },
            { kind: "file-exists", path: "state/round-2.txt" },
          ],
        },
      ],
      aggregatePredicates: [
        { kind: "file-exists", path: "state/round-1.txt" },
        { kind: "file-exists", path: "state/round-2.txt" },
      ],
      controlDecisions: ["act"],
      provenance: {
        kind: "smoke-fixture",
        justification: "minimal test fixture for multi-round runner unit tests",
      },
    }),
  );
}
