import type { IncomingMessage, ServerResponse } from "node:http";
import { getKnowledgeProvider } from "#core/modules/provider-registry.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { KnowledgeScopeStores } from "./scope.js";

export function resolveKnowledgeRouteProvider(
	req: IncomingMessage,
	res: ServerResponse,
	scopeStores: KnowledgeScopeStores | undefined,
) {
	if (!scopeStores) return getKnowledgeProvider();
	const selectedId = readSelectedScopeSelectorIdQueryOrErrorResponse(req, res);
	if (selectedId === null) return null;
	const resolved = scopeStores.resolve(selectedId);
	if (!resolved.ok) {
		jsonResponse(res, 404, resolved.error);
		return null;
	}
	return resolved.store;
}
