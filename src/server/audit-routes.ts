import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditEntry, AuditFilter } from "../extensions/guardrails-audit/store.js";
import { AuditStore } from "../extensions/guardrails-audit/store.js";
import { jsonResponse } from "./session-pool.js";

const DEFAULT_LIMIT = 200;

function parseFilter(url: URL): AuditFilter {
	const filter: AuditFilter = {};
	const limit = url.searchParams.get("limit");
	if (limit) filter.limit = Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT);
	else filter.limit = DEFAULT_LIMIT;
	const risk = url.searchParams.get("risk");
	if (risk) filter.risk = risk as AuditFilter["risk"];
	const policy = url.searchParams.get("policy");
	if (policy) filter.policy = policy as AuditFilter["policy"];
	return filter;
}

export function handleListAudit(
	req: IncomingMessage,
	res: ServerResponse,
	store?: Pick<AuditStore, "query">,
): void {
	try {
		const url = new URL(req.url ?? "/", "http://localhost");
		const filter = parseFilter(url);
		const auditStore = store ?? new AuditStore(process.cwd());
		const entries: AuditEntry[] = auditStore.query(filter);
		jsonResponse(res, 200, { entries });
	} catch (err) {
		jsonResponse(res, 500, { error: (err as Error).message });
	}
}
