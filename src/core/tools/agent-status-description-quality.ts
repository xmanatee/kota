import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  analyzeLocalToolDescriptionQuality,
  analyzeToolDefDescriptionQuality,
  type ToolDescriptionQualityReport,
} from "./description-quality.js";
import { getToolEffect, type ToolRegistration } from "./index.js";

export type ToolDescriptionQualityProvider = () => readonly ToolDescriptionQualityReport[];

type FormatToolDescriptionQualitySectionInput = {
  coreTools: readonly ToolRegistration[];
  moduleTools: readonly KotaTool[];
  remoteReports: readonly ToolDescriptionQualityReport[];
  filter: string;
};

const TOOL_DESCRIPTION_QUALITY_REPORT_LIMIT = 20;
const TOOL_DESCRIPTION_QUALITY_MESSAGE_LIMIT = 3;

export function formatToolDescriptionQualitySection(
  input: FormatToolDescriptionQualitySectionInput,
): string | null {
  const diagnosticReports = [
    ...localDescriptionQualityReports(input.coreTools, input.moduleTools),
    ...remoteDescriptionQualityReports(input.remoteReports, input.filter),
  ].filter((report) => report.diagnostics.length > 0);
  if (diagnosticReports.length === 0) return null;
  return formatDescriptionQualityReports(diagnosticReports);
}

export function hasMatchingToolDescriptionQualityReports(
  reports: readonly ToolDescriptionQualityReport[],
  filter: string,
): boolean {
  return reports.some(
    (report) => report.diagnostics.length > 0 && descriptionQualityReportMatches(report, filter),
  );
}

function localDescriptionQualityReports(
  coreTools: readonly ToolRegistration[],
  moduleTools: readonly KotaTool[],
): ToolDescriptionQualityReport[] {
  const reports: ToolDescriptionQualityReport[] = [];
  for (const registration of coreTools) {
    const diagnostics = analyzeToolDefDescriptionQuality(registration);
    if (diagnostics.length === 0) continue;
    reports.push({
      source: "local",
      toolName: registration.tool.name,
      diagnostics,
    });
  }
  for (const tool of moduleTools) {
    const effect = getToolEffect(tool.name);
    const diagnostics = analyzeLocalToolDescriptionQuality({
      tool,
      ...(effect ? { effect } : {}),
    });
    if (diagnostics.length === 0) continue;
    reports.push({
      source: "local",
      toolName: tool.name,
      diagnostics,
    });
  }
  return reports;
}

function remoteDescriptionQualityReports(
  reports: readonly ToolDescriptionQualityReport[],
  filter: string,
): ToolDescriptionQualityReport[] {
  return reports
    .filter((report) => report.diagnostics.length > 0 && descriptionQualityReportMatches(report, filter))
    .map((report) => ({
      ...report,
      diagnostics: report.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    }));
}

function descriptionQualityReportMatches(report: ToolDescriptionQualityReport, filter: string): boolean {
  if (!filter) return true;
  return matches(report.toolName, filter) ||
    matches(report.serverConfigName ?? "", filter) ||
    matches(report.serverDisplayName ?? "", filter) ||
    report.diagnostics.some((diagnostic) => matches(diagnostic.code, filter));
}

function formatDescriptionQualityReports(
  reports: readonly ToolDescriptionQualityReport[],
): string {
  const lines = ["\nDescription diagnostics:"];
  for (const report of reports.slice(0, TOOL_DESCRIPTION_QUALITY_REPORT_LIMIT)) {
    const source = report.source === "remote-mcp"
      ? `remote-mcp:${report.serverConfigName ?? "unknown"}`
      : "local";
    lines.push(
      `- ${report.toolName} [${source}]: ${formatDescriptionQualityMessages(report.diagnostics)}`,
    );
  }
  if (reports.length > TOOL_DESCRIPTION_QUALITY_REPORT_LIMIT) {
    lines.push(`- ... ${reports.length - TOOL_DESCRIPTION_QUALITY_REPORT_LIMIT} more tool(s) with diagnostics`);
  }
  return lines.join("\n");
}

function formatDescriptionQualityMessages(
  diagnostics: readonly ToolDescriptionQualityReport["diagnostics"][number][],
): string {
  const shown = diagnostics.slice(0, TOOL_DESCRIPTION_QUALITY_MESSAGE_LIMIT)
    .map((diagnostic) => `${diagnostic.code}: ${truncate(diagnostic.message, 100)}`);
  const remaining = diagnostics.length - shown.length;
  if (remaining > 0) shown.push(`${remaining} more`);
  return shown.join("; ");
}

function matches(text: string, filter: string): boolean {
  return !filter || text.toLowerCase().includes(filter);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
