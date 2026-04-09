import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSqlite, sqliteTool } from "./sqlite.js";

// Check if sqlite3 CLI is available
let hasSqlite3 = false;
try {
	execFileSync("sqlite3", ["--version"], { timeout: 5000 });
	hasSqlite3 = true;
} catch {
	// sqlite3 not available
}

const TEST_DIR = join(tmpdir(), `kota-sqlite-test-${Date.now()}`);
const TEST_DB = join(TEST_DIR, "test.db");

function setupTestDb(): void {
	mkdirSync(TEST_DIR, { recursive: true });
	execFileSync("sqlite3", [
		TEST_DB,
		`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, age INTEGER);
		 INSERT INTO users VALUES (1, 'Alice', 'alice@example.com', 30);
		 INSERT INTO users VALUES (2, 'Bob', 'bob@test.org', 25);
		 INSERT INTO users VALUES (3, 'Carol', NULL, 28);
		 CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, FOREIGN KEY (user_id) REFERENCES users(id));
		 INSERT INTO posts VALUES (1, 1, 'Hello World');
		 INSERT INTO posts VALUES (2, 2, 'Second Post');`,
	]);
}

describe("sqlite tool", () => {
	describe("tool definition", () => {
		it("has correct name and required fields", () => {
			expect(sqliteTool.name).toBe("sqlite");
			expect(sqliteTool.description).toBeTruthy();
			expect(sqliteTool.input_schema.type).toBe("object");
			const required = sqliteTool.input_schema.required as string[];
			expect(required).toContain("database");
			expect(required).toContain("action");
		});

		it("defines three actions", () => {
			const props = sqliteTool.input_schema.properties as Record<
				string,
				{ enum?: string[] }
			>;
			expect(props.action.enum).toEqual(["query", "tables", "schema"]);
		});
	});

	describe("input validation", () => {
		it("requires database path", async () => {
			const result = await runSqlite({ action: "query" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("database path is required");
		});

		it("rejects unknown action", async () => {
			const result = await runSqlite({
				database: "/tmp/test.db",
				action: "drop",
			});
			expect(result.is_error).toBe(true);
			expect(result.content).toContain('Unknown action "drop"');
		});

		it("requires sql for query action", async () => {
			if (!hasSqlite3) return;
			const result = await runSqlite({
				database: "/dev/null",
				action: "query",
			});
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("sql is required");
		});

		it("requires table for schema action", async () => {
			if (!hasSqlite3) return;
			const result = await runSqlite({
				database: TEST_DB,
				action: "schema",
			});
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("table name is required");
		});

		it("rejects invalid table names", async () => {
			if (!hasSqlite3) return;
			const result = await runSqlite({
				database: TEST_DB,
				action: "schema",
				table: "users; DROP TABLE users",
			});
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("Invalid table name");
		});

		it("checks database existence for tables action", async () => {
			const result = await runSqlite({
				database: "/nonexistent/path/db.sqlite",
				action: "tables",
			});
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("Database not found");
		});

		it("checks database existence for schema action", async () => {
			const result = await runSqlite({
				database: "/nonexistent/path/db.sqlite",
				action: "schema",
				table: "users",
			});
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("Database not found");
		});
	});

	// Integration tests that require sqlite3 CLI
	describe("integration (requires sqlite3)", () => {
		beforeAll(() => {
			if (!hasSqlite3) return;
			setupTestDb();
		});

		afterAll(() => {
			if (existsSync(TEST_DIR)) {
				rmSync(TEST_DIR, { recursive: true, force: true });
			}
		});

		describe("tables action", () => {
			it("lists all tables", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "tables",
				});
				expect(result.is_error).toBeUndefined();
				expect(result.content).toContain("2 table(s)");
				expect(result.content).toContain("posts");
				expect(result.content).toContain("users");
			});

			it("returns no tables for empty database", async () => {
				if (!hasSqlite3) return;
				const emptyDb = join(TEST_DIR, "empty.db");
				execFileSync("sqlite3", [
					emptyDb,
					"SELECT 1;",
				]);
				const result = await runSqlite({
					database: emptyDb,
					action: "tables",
				});
				expect(result.content).toContain("(no tables)");
			});
		});

		describe("schema action", () => {
			it("shows table structure", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "schema",
					table: "users",
				});
				expect(result.is_error).toBeUndefined();
				expect(result.content).toContain("Table: users");
				expect(result.content).toContain("Columns (4)");
				expect(result.content).toContain("id");
				expect(result.content).toContain("INTEGER");
				expect(result.content).toContain("PRIMARY KEY");
				expect(result.content).toContain("name");
				expect(result.content).toContain("NOT NULL");
				expect(result.content).toContain("email");
				expect(result.content).toContain("age");
			});

			it("includes row count", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "schema",
					table: "users",
				});
				expect(result.content).toContain("Rows: 3");
			});

			it("includes DDL", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "schema",
					table: "users",
				});
				expect(result.content).toContain("DDL:");
				expect(result.content).toContain("CREATE TABLE");
			});

			it("returns error for nonexistent table", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "schema",
					table: "nonexistent",
				});
				expect(result.is_error).toBe(true);
				expect(result.content).toContain("Table not found");
			});
		});

		describe("query action", () => {
			it("runs SELECT and returns markdown table", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "SELECT * FROM users ORDER BY id",
				});
				expect(result.is_error).toBeUndefined();
				expect(result.content).toContain("3 row(s)");
				expect(result.content).toContain("Alice");
				expect(result.content).toContain("Bob");
				expect(result.content).toContain("Carol");
				// Markdown table format
				expect(result.content).toContain("|");
				expect(result.content).toContain("---");
			});

			it("handles NULL values", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "SELECT name, email FROM users WHERE email IS NULL",
				});
				expect(result.content).toContain("Carol");
				expect(result.content).toContain("NULL");
			});

			it("handles empty result set", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "SELECT * FROM users WHERE id > 999",
				});
				expect(result.content).toBe("(no results)");
			});

			it("handles JOIN queries", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id ORDER BY p.id",
				});
				expect(result.content).toContain("Alice");
				expect(result.content).toContain("Hello World");
				expect(result.content).toContain("Bob");
				expect(result.content).toContain("Second Post");
			});

			it("handles aggregate queries", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "SELECT COUNT(*) as total, AVG(age) as avg_age FROM users",
				});
				expect(result.content).toContain("total");
				expect(result.content).toContain("avg_age");
			});

			it("handles PRAGMA queries", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "PRAGMA table_list",
				});
				expect(result.is_error).toBeUndefined();
			});

			it("reports SQL errors", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "SELECT * FROM nonexistent_table",
				});
				expect(result.is_error).toBe(true);
				expect(result.content).toContain("no such table");
			});

			it("reports syntax errors", async () => {
				if (!hasSqlite3) return;
				const result = await runSqlite({
					database: TEST_DB,
					action: "query",
					sql: "SELEKT * FROM users",
				});
				expect(result.is_error).toBe(true);
			});

			it("executes INSERT and reports affected rows", async () => {
				if (!hasSqlite3) return;
				const mutDb = join(TEST_DIR, "mutation.db");
				execFileSync("sqlite3", [
					mutDb,
					"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);",
				]);
				const result = await runSqlite({
					database: mutDb,
					action: "query",
					sql: "INSERT INTO items VALUES (1, 'Widget')",
				});
				expect(result.is_error).toBeUndefined();
				expect(result.content).toContain("1 row(s) affected");
			});

			it("executes UPDATE and reports affected rows", async () => {
				if (!hasSqlite3) return;
				const mutDb = join(TEST_DIR, "update.db");
				execFileSync("sqlite3", [
					mutDb,
					"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES (1, 'Old'); INSERT INTO items VALUES (2, 'Old');",
				]);
				const result = await runSqlite({
					database: mutDb,
					action: "query",
					sql: "UPDATE items SET name = 'New' WHERE name = 'Old'",
				});
				expect(result.is_error).toBeUndefined();
				expect(result.content).toContain("2 row(s) affected");
			});

			it("executes DELETE and reports affected rows", async () => {
				if (!hasSqlite3) return;
				const mutDb = join(TEST_DIR, "delete.db");
				execFileSync("sqlite3", [
					mutDb,
					"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES (1, 'A'); INSERT INTO items VALUES (2, 'B');",
				]);
				const result = await runSqlite({
					database: mutDb,
					action: "query",
					sql: "DELETE FROM items WHERE id = 1",
				});
				expect(result.is_error).toBeUndefined();
				expect(result.content).toContain("1 row(s) affected");
			});

			it("executes CREATE TABLE", async () => {
				if (!hasSqlite3) return;
				const mutDb = join(TEST_DIR, "create.db");
				execFileSync("sqlite3", [mutDb, "SELECT 1;"]);
				const result = await runSqlite({
					database: mutDb,
					action: "query",
					sql: "CREATE TABLE new_table (id INTEGER PRIMARY KEY, data TEXT)",
				});
				expect(result.is_error).toBeUndefined();
				expect(result.content).toContain("OK");
			});

			it("creates new database file for query action", async () => {
				if (!hasSqlite3) return;
				const newDb = join(TEST_DIR, "brand_new.db");
				expect(existsSync(newDb)).toBe(false);
				const result = await runSqlite({
					database: newDb,
					action: "query",
					sql: "CREATE TABLE test (id INTEGER PRIMARY KEY)",
				});
				expect(result.is_error).toBeUndefined();
				expect(existsSync(newDb)).toBe(true);
			});
		});
	});
});
