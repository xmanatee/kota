import type { DaemonScopeProvider } from "#core/daemon/scope-provider.js";
import {
	buildDirectoryScope,
	type DirectoryScope,
	type ScopeId,
} from "#core/daemon/scope-registry.js";
import { createDirectoryScopeSelector, type DirectoryScopeSelectionOptions } from "#core/daemon/scope-selection.js";
import type { RepoTasksProvider } from "#core/modules/provider-types.js";
import { nativeRunRepositoryAccess } from "#core/workflow/run-context.js";
import type { WorkflowDispatcher } from "#core/workflow/workflow-dispatcher-provider.js";
import type { RepoTaskMutationTarget } from "./repo-task-mutation-boundary.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";

export type UnknownRepoTasksScopeError = {
	error: "Unknown scope";
	reason: "unknown_scope";
	scopeId: string;
};

export type RepoTasksScopeStoresOptions = DirectoryScopeSelectionOptions & {
	getDefaultProvider?: () => RepoTasksProvider | null;
	getWorkflowDispatcher?: () => WorkflowDispatcher | null;
};

export type ResolvedRepoTasksScope = {
	scopeId: ScopeId;
	scopeRoot: string;
	store: RepoTasksProvider;
} & RepoTaskMutationTarget;

export class RepoTasksScopeStores {
	private readonly fallbackScope: DirectoryScope;
	private readonly selectScope: ReturnType<typeof createDirectoryScopeSelector>;
	private readonly getDefaultProvider: (() => RepoTasksProvider | null) | undefined;
	private readonly stores = new Map<ScopeId, RepoTasksProvider>();
	private readonly getWorkflowDispatcher: () => WorkflowDispatcher | null;

	constructor(options: RepoTasksScopeStoresOptions) {
		this.fallbackScope = buildDirectoryScope({
			scopeRoot: options.defaultScopeRoot,
		});
		this.selectScope = createDirectoryScopeSelector(options);
		this.getDefaultProvider = options.getDefaultProvider;
		this.getWorkflowDispatcher = options.getWorkflowDispatcher ?? (() => null);
	}

	resolve(
		scopeId: string | null | undefined,
	):
		| ({ ok: true } & ResolvedRepoTasksScope)
		| { ok: false; error: UnknownRepoTasksScopeError } {
		const selected = this.selectScope(scopeId);
		if (!selected.ok) return selected;
		const scope = selected.scope;
		const repositoryAccess = scope.scopeRoot === this.fallbackScope.scopeRoot
			? nativeRunRepositoryAccess(this.fallbackScope.scopeRoot)
			: null;
		return {
			ok: true,
			scopeId: scope.scopeId,
			scopeRoot: scope.scopeRoot,
			store: this.storeFor(scope),
			...(repositoryAccess === null
				? {
					authority: "canonical" as const,
					getDispatcher: this.getWorkflowDispatcher,
				}
				: {
					authority: "runtime-owned-sandbox" as const,
					repositoryAccess,
				}),
		};
	}

	private storeFor(scope: DirectoryScope): RepoTasksProvider {
		if (scope.scopeId === this.fallbackScope.scopeId) {
			const provider = this.getDefaultProvider?.();
			if (provider) return provider;
		}
		const existing = this.stores.get(scope.scopeId);
		if (existing) return existing;
		const store = new RepoTasksDefaultStore(scope.scopeRoot);
		this.stores.set(scope.scopeId, store);
		return store;
	}
}

export function createRepoTasksScopeStores(
	defaultScopeRoot: string,
	getDefaultProvider?: () => RepoTasksProvider | null,
	getDaemonScopeProvider?: () => DaemonScopeProvider | null,
	getWorkflowDispatcher?: () => WorkflowDispatcher | null,
): RepoTasksScopeStores {
	return new RepoTasksScopeStores({
		defaultScopeRoot,
		getDefaultProvider,
		getDaemonScopeProvider,
		getWorkflowDispatcher,
	});
}
