/** Shared composition for cross-store capture and retraction; providers retain storage ownership. */

import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { ScopeId } from "#core/daemon/scope-registry.js";
import type { ProviderLookupContext } from "#core/modules/module-context-types.js";
import {
	getKnowledgeProvider,
	getMemoryProvider,
	KNOWLEDGE_PROVIDER_TOKEN,
	MEMORY_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type {
	KnowledgeProvider,
	MemoryProvider,
} from "#core/modules/provider-types.js";
import type { WorkflowDispatcher } from "#core/workflow/workflow-dispatcher-provider.js";
import { WORKFLOW_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-dispatcher-provider.js";
import { KnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { MemoryScopeStores } from "#modules/memory/scope.js";

export type StoreScopeContext = {
	scopeId: ScopeId;
	scopeRoot: string;
	memory: MemoryProvider;
	knowledge: KnowledgeProvider;
	getWorkflowDispatcher: () => WorkflowDispatcher | null;
};
export type ResolveStoreScopeContext = (
	scopeId: string | null | undefined,
) => StoreScopeContext | { error: "unknown_scope"; scopeId: string };

export function createStoreScopeContextResolver(
	defaultScopeRoot: string,
	providers?: ProviderLookupContext,
): ResolveStoreScopeContext {
	const memoryStores = new MemoryScopeStores({
		defaultScopeRoot,
		getDefaultProvider: () =>
			providers
				? providers.getProvider(MEMORY_PROVIDER_TOKEN)
				: getMemoryProvider(),
		getDaemonScopeProvider: providers
			? () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)
			: undefined,
	});
	const knowledgeStores = new KnowledgeScopeStores({
		defaultScopeRoot,
		getDefaultProvider: () =>
			providers
				? providers.getProvider(KNOWLEDGE_PROVIDER_TOKEN)
				: getKnowledgeProvider(),
		getDaemonScopeProvider: providers
			? () => providers.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)
			: undefined,
	});

	return (scopeId) => {
		const memory = memoryStores.resolve(scopeId);
		if (!memory.ok)
			return { error: "unknown_scope", scopeId: memory.error.scopeId };
		const knowledge = knowledgeStores.resolve(memory.scopeId);
		if (!knowledge.ok)
			return { error: "unknown_scope", scopeId: knowledge.error.scopeId };
		return {
			scopeId: memory.scopeId,
			scopeRoot: memory.scopeRoot,
			memory: memory.store,
			knowledge: knowledge.store,
			getWorkflowDispatcher: () =>
				providers?.getProvider(WORKFLOW_DISPATCHER_PROVIDER_TYPE) ?? null,
		};
	};
}
