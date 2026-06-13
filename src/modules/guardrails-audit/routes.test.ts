import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import type { AuditEntry, AuditFilter } from "#core/tools/audit-store.js";
import { networkWriteEffect } from "#core/tools/effect.js";
import { makeListAuditHandlerForStore } from "./routes.js";

function mockReqRes(url = "/api/audit") {
	const result = { status: 0, body: null as unknown };
	const req = { url } as IncomingMessage;
	const res = {
		setHeader: vi.fn(),
		writeHead: (s: number) => {
			result.status = s;
		},
		end: (data: string) => {
			result.body = JSON.parse(data);
		},
		on: vi.fn(),
	} as unknown as ServerResponse;
	return { req, res, result };
}

type FakeStore = { query: (filter?: AuditFilter) => AuditEntry[] };

function makeStore(entries: AuditEntry[] = [], spy?: (filter?: AuditFilter) => AuditEntry[]): FakeStore {
	const query = spy ?? ((_filter?: AuditFilter) => entries);
	return { query };
}

function makeCtx(manifest?: ModuleCapabilityManifestProjection): ModuleContext {
	const summaries: ModuleSummary[] = manifest
		? [
				{
					name: manifest.moduleName,
					source: "project",
					dependencies: [],
					toolNames: [],
					workflowNames: [],
					channelNames: [],
					skillNames: [],
					agentNames: [],
					agents: [],
					skills: [],
					commandNames: [],
					routeSummaries: [],
					manifest,
				},
			]
		: [];
	return {
		cwd: process.cwd(),
		getModuleSummaries: () => summaries,
	} as unknown as ModuleContext;
}

function makeManifest(): ModuleCapabilityManifestProjection {
	const effect = networkWriteEffect();
	return {
		schemaVersion: 1,
		moduleName: "web-access",
		dependencies: [],
		capabilities: [
			{
				id: "web-access.http",
				description: "HTTP access.",
				scope: "external",
				scopePolicyHooks: ["external-effects"],
			},
		],
		dataClasses: [
			{
				id: "web-access.payload",
				description: "Request and response metadata.",
				sensitivity: "provider-payload",
				retention: "run-artifact",
				redaction: "omit-payload",
			},
		],
		contributions: {
			tools: ["http_request"],
			workflows: [],
			workflowTriggers: [],
			channels: [],
			skills: [],
			agents: [],
			commands: [],
			routes: [],
			controlRoutes: [],
			events: [],
			eventFlows: [],
			clients: { localNamespaces: [], daemonFactory: false },
			setupRequirements: [],
		},
		effects: [
			{
				id: "tool.http_request",
				description: "HTTP request",
				source: "tool",
				target: "http_request",
				effect,
				risk: "moderate",
				categories: ["external-write"],
				capabilityIds: ["web-access.http"],
				simulation: {
					blocked: true,
					reason: "tool would produce a live external or operator-visible side effect in trial mode",
				},
			},
		],
		simulation: {
			support: "external-effects-blocked",
			blockedReasons: ["HTTP writes are blocked in trial mode."],
		},
		readiness: {
			setupRequirementIds: [],
			healthCapabilityIds: [],
			healthCheck: "not-declared",
		},
	};
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	return {
		ts: "2026-01-01T00:00:00Z",
		tool: "bash",
		risk: "safe",
		policy: "allow",
		reason: "Safe read-only command",
		...overrides,
	};
}

describe("audit routes", () => {
	describe("handleListAudit", () => {
		it("returns 200 with empty entries when store is empty", () => {
			const store = makeStore([]);
			const { req, res, result } = mockReqRes();
			makeListAuditHandlerForStore(makeCtx(), () => store)(req, res, {});
			expect(result.status).toBe(200);
			const body = result.body as { entries: unknown[] };
			expect(body.entries).toEqual([]);
		});

		it("returns entries from the store", () => {
			const entry = makeEntry({ tool: "file_read", risk: "moderate", policy: "confirm" });
			const store = makeStore([entry]);
			const { req, res, result } = mockReqRes();
			makeListAuditHandlerForStore(makeCtx(), () => store)(req, res, {});
			expect(result.status).toBe(200);
			const body = result.body as { entries: AuditEntry[] };
			expect(body.entries).toHaveLength(1);
			expect(body.entries[0].tool).toBe("file_read");
			expect(body.entries[0].risk).toBe("moderate");
			expect(body.entries[0].policy).toBe("confirm");
		});

		it("passes risk filter from query string to store", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit?risk=dangerous");
			makeListAuditHandlerForStore(makeCtx(), () => store)(req, res, {});
			expect(calls[0]).toMatchObject({ risk: "dangerous" });
		});

		it("passes policy filter from query string to store", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit?policy=deny");
			makeListAuditHandlerForStore(makeCtx(), () => store)(req, res, {});
			expect(calls[0]).toMatchObject({ policy: "deny" });
		});

		it("defaults limit to 200", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit");
			makeListAuditHandlerForStore(makeCtx(), () => store)(req, res, {});
			expect(calls[0]).toMatchObject({ limit: 200 });
		});

		it("accepts custom limit from query string", () => {
			const calls: Array<AuditFilter | undefined> = [];
			const store: FakeStore = {
				query: (f) => { calls.push(f); return []; },
			};
			const { req, res } = mockReqRes("/api/audit?limit=50");
			makeListAuditHandlerForStore(makeCtx(), () => store)(req, res, {});
			expect(calls[0]).toMatchObject({ limit: 50 });
		});

		it("annotates matching tools with manifest capability and data context", () => {
			const store = makeStore([makeEntry({ tool: "http_request" })]);
			const { req, res, result } = mockReqRes();
			makeListAuditHandlerForStore(makeCtx(makeManifest()), () => store)(req, res, {});
			expect(result.status).toBe(200);
			const body = result.body as { entries: Array<{ manifest?: { moduleName: string; capabilities: Array<{ id: string }>; dataClasses: Array<{ id: string }> } }> };
			expect(body.entries[0].manifest?.moduleName).toBe("web-access");
			expect(body.entries[0].manifest?.capabilities.map((capability) => capability.id)).toEqual([
				"web-access.http",
			]);
			expect(body.entries[0].manifest?.dataClasses.map((dataClass) => dataClass.id)).toEqual([
				"web-access.payload",
			]);
		});

		it("returns 500 when store throws", () => {
			const store: FakeStore = {
				query: () => { throw new Error("disk error"); },
			};
			const { req, res, result } = mockReqRes();
			makeListAuditHandlerForStore(makeCtx(), () => store)(req, res, {});
			expect(result.status).toBe(500);
			expect((result.body as { error: string }).error).toBe("disk error");
		});
	});
});
