import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModuleContext, ModuleRouteHandler } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { AuditStore, getAuditStore } from "#core/tools/audit-store.js";
import {
	type AuditQueryStore,
	listAuditEntriesFromStore,
} from "./audit-operations.js";
import type { AuditListFilter } from "./client.js";

const DEFAULT_LIMIT = 200;

function parseFilter(url: URL): AuditListFilter {
	const filter: AuditListFilter = {};
	const limit = url.searchParams.get("limit");
	if (limit) filter.limit = Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT);
	else filter.limit = DEFAULT_LIMIT;
	const risk = url.searchParams.get("risk");
	if (risk) filter.risk = risk as AuditListFilter["risk"];
	const policy = url.searchParams.get("policy");
	if (policy) filter.policy = policy as AuditListFilter["policy"];
	return filter;
}

export function makeListAuditHandlerForStore(
	ctx: ModuleContext,
	resolveStore: () => AuditQueryStore,
): ModuleRouteHandler {
	return (req: IncomingMessage, res: ServerResponse) => {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			const filter = parseFilter(url);
			jsonResponse(res, 200, listAuditEntriesFromStore(ctx, resolveStore(), filter));
		} catch (err) {
			jsonResponse(res, 500, { error: (err as Error).message });
		}
	};
}

/** Build a `/api/audit` route handler against the active module context. */
export function makeListAuditHandler(ctx: ModuleContext): ModuleRouteHandler {
	return makeListAuditHandlerForStore(
		ctx,
		() => getAuditStore() ?? new AuditStore(ctx.cwd),
	);
}
