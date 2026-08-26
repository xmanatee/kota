import type { IncomingMessage, ServerResponse } from "node:http";
import { getKnowledgeProvider } from "#core/modules/provider-registry.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { resolveKnowledgeRouteProvider } from "./route-provider.js";
import type { KnowledgeScopeStores } from "./scope.js";

export function handleDeleteKnowledge(res: ServerResponse, id: string): void {
	try {
		const provider = getKnowledgeProvider();
		const ok = provider.delete(id);
		if (!ok) {
			jsonResponse(res, 404, { error: "Not found" });
			return;
		}
		jsonResponse(res, 200, { deleted: id });
	} catch (err) {
		jsonResponse(res, 500, { error: (err as Error).message });
	}
}

export function handleDeleteKnowledgeScoped(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	scopeStores: KnowledgeScopeStores,
): void {
	try {
		const provider = resolveKnowledgeRouteProvider(req, res, scopeStores);
		if (!provider) return;
		const ok = provider.delete(id);
		if (!ok) {
			jsonResponse(res, 404, { error: "Not found" });
			return;
		}
		jsonResponse(res, 200, { deleted: id });
	} catch (err) {
		jsonResponse(res, 500, { error: (err as Error).message });
	}
}
