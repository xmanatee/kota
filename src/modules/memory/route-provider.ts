import type { IncomingMessage, ServerResponse } from "node:http";
import { getMemoryProvider } from "#core/modules/provider-registry.js";
import {
	selectedScopeSelectorId,
	unknownScopeSelectorBody,
} from "#core/server/scope-selector.js";
import { readScopeSelectorQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { MemoryProjectStores } from "./project-scope.js";

export function resolveMemoryRouteProvider(
	req: IncomingMessage,
	res: ServerResponse,
	projectStores: MemoryProjectStores | undefined,
) {
	if (!projectStores) return getMemoryProvider();
	const selector = readScopeSelectorQueryOrErrorResponse(req, res);
	if (selector === null) return null;
	const selectedId = selectedScopeSelectorId(selector);
	const resolved = projectStores.resolve(selectedId);
	if (!resolved.ok) {
		jsonResponse(
			res,
			404,
			unknownScopeSelectorBody(selector, resolved.error.projectId),
		);
		return null;
	}
	return resolved.store;
}
