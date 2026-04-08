import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "../../tools/tool-result.js";

export const sqliteTool: Anthropic.Tool = {
	name: "sqlite",
	description:
		"Query SQLite databases. Run SQL, list tables, inspect schemas. " +
		"Returns results as markdown tables. Use for data analysis, app debugging, or structured queries.",
	input_schema: {
		type: "object" as const,
		properties: {
			database: {
				type: "string",
				description: "Path to the SQLite database file",
			},
			action: {
				type: "string",
				enum: ["query", "tables", "schema"],
				description:
					"query: run SQL. tables: list all tables. schema: show table structure.",
			},
			sql: {
				type: "string",
				description: "SQL to execute (required for query action)",
			},
			table: {
				type: "string",
				description: "Table name (required for schema action)",
			},
		},
		required: ["database", "action"],
	},
};

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const MAX_ROWS = 100;
const MAX_OUTPUT_CHARS = 50_000;

function err(msg: string): ToolResult {
	return { content: msg, is_error: true };
}

function execSql(
	database: string,
	sql: string,
): { stdout: string; error?: string } {
	try {
		const stdout = execFileSync("sqlite3", ["-json", database, sql], {
			timeout: TIMEOUT_MS,
			maxBuffer: MAX_BUFFER,
			stdio: ["pipe", "pipe", "pipe"],
		}).toString("utf-8");
		return { stdout: stdout.trim() };
	} catch (e) {
		const nodeErr = e as NodeJS.ErrnoException & { stderr?: Buffer };
		if (nodeErr.code === "ENOENT") {
			return {
				stdout: "",
				error:
					"sqlite3 not found. Install: brew install sqlite3 (macOS) or apt install sqlite3 (Linux).",
			};
		}
		const stderr = nodeErr.stderr?.toString("utf-8")?.trim() || "";
		const msg = stderr || (e instanceof Error ? e.message : String(e));
		return { stdout: "", error: msg };
	}
}

function formatTable(rows: Record<string, unknown>[]): string {
	if (rows.length === 0) return "(no results)";

	const cols = Object.keys(rows[0]);
	const truncated = rows.length > MAX_ROWS;
	const displayRows = truncated ? rows.slice(0, MAX_ROWS) : rows;

	const fmtCell = (v: unknown): string => {
		if (v === null || v === undefined) return "NULL";
		const s = String(v);
		return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
	};

	const widths = cols.map((c) =>
		Math.max(c.length, ...displayRows.map((r) => fmtCell(r[c]).length)),
	);

	const pad = (s: string, w: number) =>
		s + " ".repeat(Math.max(0, w - s.length));
	const header = `| ${cols.map((c, i) => pad(c, widths[i])).join(" | ")} |`;
	const sep = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
	const body = displayRows.map(
		(r) =>
			`| ${cols.map((c, i) => pad(fmtCell(r[c]), widths[i])).join(" | ")} |`,
	);

	let result = [header, sep, ...body].join("\n");
	if (truncated) {
		result += `\n[Showing ${MAX_ROWS} of ${rows.length} rows]`;
	}
	if (result.length > MAX_OUTPUT_CHARS) {
		result =
			result.slice(0, MAX_OUTPUT_CHARS) +
			`\n[Truncated at ${MAX_OUTPUT_CHARS} chars]`;
	}
	return `${rows.length} row(s)\n\n${result}`;
}

function queryTables(database: string): ToolResult {
	const sql =
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
	const result = execSql(database, sql);
	if (result.error) return err(result.error);
	if (!result.stdout) return { content: "(no tables)" };

	const rows = JSON.parse(result.stdout) as { name: string }[];
	if (rows.length === 0) return { content: "(no tables)" };

	const names = rows.map((r) => r.name);
	return {
		content: `${names.length} table(s):\n${names.map((n) => `- ${n}`).join("\n")}`,
	};
}

function querySchema(database: string, table: string): ToolResult {

	const infoResult = execSql(
		database,
		`PRAGMA table_info("${table}")`,
	);
	if (infoResult.error) return err(infoResult.error);
	if (!infoResult.stdout) return err(`Table not found: ${table}`);

	const columns = JSON.parse(infoResult.stdout) as {
		name: string;
		type: string;
		pk: number;
		notnull: number;
		dflt_value: unknown;
	}[];
	if (columns.length === 0) return err(`Table not found: ${table}`);

	const colLines = columns.map((col) => {
		const parts = [col.name, col.type || "ANY"];
		if (col.pk) parts.push("PRIMARY KEY");
		if (col.notnull) parts.push("NOT NULL");
		if (col.dflt_value != null) parts.push(`DEFAULT ${col.dflt_value}`);
		return `- ${parts.join(" | ")}`;
	});

	let output = `Table: ${table}\n\nColumns (${columns.length}):\n${colLines.join("\n")}`;

	const countResult = execSql(
		database,
		`SELECT COUNT(*) as count FROM "${table}"`,
	);
	if (!countResult.error && countResult.stdout) {
		const countRows = JSON.parse(countResult.stdout) as { count: number }[];
		if (countRows.length > 0) {
			output += `\n\nRows: ${countRows[0].count}`;
		}
	}

	const ddlResult = execSql(
		database,
		`SELECT sql FROM sqlite_master WHERE name='${table}' AND type IN ('table','view')`,
	);
	if (!ddlResult.error && ddlResult.stdout) {
		const ddlRows = JSON.parse(ddlResult.stdout) as { sql: string }[];
		if (ddlRows.length > 0 && ddlRows[0].sql) {
			output += `\n\nDDL:\n${ddlRows[0].sql}`;
		}
	}

	return { content: output };
}

function queryExec(database: string, sql: string): ToolResult {

	const isMutation =
		/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(sql);

	if (isMutation) {
		const combined = `${sql.replace(/;\s*$/, "")}; SELECT changes() AS affected_rows;`;
		const result = execSql(database, combined);
		if (result.error) return err(result.error);
		if (result.stdout) {
			const rows = JSON.parse(result.stdout) as {
				affected_rows: number;
			}[];
			if (rows.length > 0) {
				return { content: `OK. ${rows[0].affected_rows} row(s) affected.` };
			}
		}
		return { content: "OK." };
	}

	const result = execSql(database, sql);
	if (result.error) return err(result.error);
	if (!result.stdout) return { content: "(no results)" };

	const rows = JSON.parse(result.stdout) as Record<string, unknown>[];
	if (rows.length === 0) return { content: "(no results)" };

	return { content: formatTable(rows) };
}

export async function runSqlite(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const database = input.database as string;
	const action = input.action as string;

	if (!database) return err("database path is required");

	// Validate action-specific params before I/O
	if (action === "query" && !input.sql) return err("sql is required for query action");
	if (action === "schema") {
		if (!input.table) return err("table name is required for schema action");
		if (!/^[\w.]+$/i.test(input.table as string)) return err("Invalid table name");
	}

	// Check file existence for read-only actions
	if ((action === "tables" || action === "schema") && !existsSync(database)) {
		return err(`Database not found: ${database}`);
	}

	switch (action) {
		case "tables":
			return queryTables(database);
		case "schema":
			return querySchema(database, input.table as string);
		case "query":
			return queryExec(database, input.sql as string);
		default:
			return err(`Unknown action "${action}". Use: query, tables, schema.`);
	}
}

export const registration = {
	tool: sqliteTool,
	runner: runSqlite,
	risk: "moderate" as const,
	kind: "action" as const,
	group: "code",
};
