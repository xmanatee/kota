import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeCalibratedShellFixture(
  fixturesRoot: string,
  id: string,
  checkerSource: string,
  options: {
    acceptedAlternative?: {
      id: string;
      content: string;
    };
  } = {},
): void {
  const fixtureDir = join(fixturesRoot, id);
  mkdirSync(join(fixtureDir, "initial", "scripts"), { recursive: true });
  mkdirSync(join(fixtureDir, "calibration", "golden"), { recursive: true });
  mkdirSync(join(fixtureDir, "calibration", "adversarial"), { recursive: true });
  if (options.acceptedAlternative !== undefined) {
    mkdirSync(
      join(
        fixtureDir,
        "calibration",
        "accepted-alternatives",
        options.acceptedAlternative.id,
      ),
      { recursive: true },
    );
    writeFileSync(
      join(
        fixtureDir,
        "calibration",
        "accepted-alternatives",
        options.acceptedAlternative.id,
        "result.txt",
      ),
      options.acceptedAlternative.content,
    );
  }
  writeFileSync(join(fixtureDir, "initial", "scripts", "check.mjs"), checkerSource);
  writeFileSync(join(fixtureDir, "calibration", "golden", "result.txt"), "ok\n");
  writeFileSync(
    join(fixtureDir, "calibration", "adversarial", "result.txt"),
    "shortcut\n",
  );
  writeFileSync(
    join(fixtureDir, "fixture.json"),
    JSON.stringify({
      id,
      description: "calibrated shell verifier fixture",
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [
        {
          kind: "shell-succeeds",
          command: "node scripts/check.mjs",
          timeoutMs: 10_000,
        },
      ],
      preRunExpectations: [
        {
          predicate: {
            kind: "shell-succeeds",
            command: "node scripts/check.mjs",
            timeoutMs: 10_000,
          },
          expected: "fail",
        },
      ],
      verifierCalibration: {
        null: {},
        golden: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
        ...(options.acceptedAlternative !== undefined && {
          acceptedAlternatives: [
            {
              id: options.acceptedAlternative.id,
              setup: [
                {
                  kind: "copy-fixture-file",
                  sourcePath: `calibration/accepted-alternatives/${options.acceptedAlternative.id}/result.txt`,
                  targetPath: "result.txt",
                },
              ],
            },
          ],
        }),
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
      },
      controlDecisions: ["act"],
      provenance: {
        kind: "smoke-fixture",
        justification: "tests verifier calibration without invoking an agent",
      },
    }),
  );
}

export const strictCheckerSource = `import { existsSync, readFileSync } from "node:fs";

const value = existsSync("result.txt")
  ? readFileSync("result.txt", "utf8").trim()
  : "";
process.exit(value === "ok" ? 0 : 1);
`;

export const alternativeAcceptingCheckerSource = `import { existsSync, readFileSync } from "node:fs";

const value = existsSync("result.txt")
  ? readFileSync("result.txt", "utf8").trim()
  : "";
process.exit(value === "ok" || value === "also-ok" ? 0 : 1);
`;

export const alwaysPassCheckerSource = `process.exit(0);
`;

export const alwaysFailCheckerSource = `process.exit(1);
`;

export const shortcutAcceptingCheckerSource = `import { existsSync, readFileSync } from "node:fs";

const value = existsSync("result.txt")
  ? readFileSync("result.txt", "utf8").trim()
  : "";
process.exit(value === "ok" || value === "shortcut" ? 0 : 1);
`;
