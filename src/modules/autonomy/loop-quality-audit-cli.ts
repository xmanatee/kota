import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import {
  auditLoopQuality,
  type LoopQualityAuditReport,
  type LoopQualityWorkflowInput,
} from "./loop-quality-audit.js";

export type LoopQualityAuditCommandOptions = {
  json?: boolean;
  artifact?: string;
};

export function buildLoopQualityAuditCommand(
  loadWorkflows: () =>
    | readonly LoopQualityWorkflowInput[]
    | Promise<readonly LoopQualityWorkflowInput[]>,
): Command {
  return new Command("loop-quality")
    .description("Audit autonomy workflows for loop brakes, context hygiene, and verifier rails")
    .option("--json", "Emit the structured loop-quality report as JSON")
    .option("--artifact <path>", "Write the structured report JSON to a file")
    .action(async (opts: LoopQualityAuditCommandOptions) => {
      const workflows = await loadWorkflows();
      const report = auditLoopQuality(workflows);
      if (opts.artifact) {
        writeArtifact(resolveArtifactPath(resolveProjectDir(), opts.artifact), report);
      }
      if (opts.json) {
        writeJson(report, { pretty: true });
        return;
      }
      print(renderLoopQualityAudit(report));
    });
}

export function renderLoopQualityAudit(report: LoopQualityAuditReport) {
  const summary = report.summary;
  const lines = [
    line(
      span("Loop quality audit", "accent", true),
      plain(
        `: ${summary.workflowCount} workflow(s), ${summary.findingCount} finding(s), ` +
          `${summary.errorCount} error(s), ${summary.warningCount} warning(s)`,
      ),
    ),
  ];
  for (const workflow of report.workflows) {
    const findings = workflow.checks.filter((check) => check.finding);
    const status = findings.some((check) => check.status === "error")
      ? "error"
      : findings.length > 0
        ? "warn"
        : "success";
    lines.push(line(span(workflow.workflow, status, true)));
    for (const check of workflow.checks) {
      if (check.finding) {
        lines.push(line(
          plain("  "),
          span(check.finding.id, check.finding.severity === "error" ? "error" : "warn"),
          plain(` ${check.finding.message}`),
        ));
        for (const evidence of check.finding.evidence) {
          lines.push(line(plain(`    evidence: ${evidence.ref} (${evidence.detail})`)));
        }
      } else {
        const evidence = check.evidence[0];
        lines.push(line(
          plain("  "),
          span(check.status, check.status === "pass" ? "success" : "muted"),
          plain(` ${check.check}`),
          evidence ? plain(` - ${evidence.ref}`) : plain(""),
        ));
      }
    }
  }
  return stack(...lines);
}

function resolveArtifactPath(projectDir: string, rawPath: string): string {
  return isAbsolute(rawPath) ? rawPath : join(projectDir, rawPath);
}

function writeArtifact(path: string, report: LoopQualityAuditReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}
