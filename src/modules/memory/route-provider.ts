import type { IncomingMessage, ServerResponse } from "node:http";
import { getMemoryProvider } from "#core/modules/provider-registry.js";
import {
	selectedScopeSelectorId,
	unknownScopeSelectorBody,
} from "#core/server/scope-selector.js";
import { readScopeSelectorQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { MemoryScopeStores } from "./scope.js";

export function resolveMemoryRouteProvider(
	req: IncomingMessage,
	res: ServerResponse,
	scopeStores: MemoryScopeStores | undefined,
) {
	if (!scopeStores) return getMemoryProvider();
	const selector = readScopeSelectorQueryOrErrorResponse(req, res);
	if (selector === null) return null;
	const selectedId = selectedScopeSelectorId(selector);
	const resolved = scopeStores.resolve(selectedId);
	if (!resolved.ok) {
		jsonResponse(
			res,
			404,
			unknownScopeSelectorBody(resolved.error.scopeId),
		);
		return null;
	}
	return resolved.store;
}
