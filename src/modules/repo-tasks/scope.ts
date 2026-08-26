import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
	buildDirectoryScope,
	type DirectoryScope,
	directoryScopesFromProjection,
	type ScopeId,
} from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { RepoTasksProvider } from "#core/modules/provider-types.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";

export type UnknownRepoTasksScopeError = {
	error: "Unknown scope";
	reason: "unknown_scope";
	scopeId: string;
};

type ScopeSnapshot = {
	defaultScopeId: ScopeId;
	activeScopeId: ScopeId | null;
	scopes: readonly DirectoryScope[];
};

export type RepoTasksScopeStoresOptions = {
	defaultScopeRoot: string;
	scopes?: readonly DirectoryScope[];
	defaultScopeId?: ScopeId;
	getActiveScopeId?: () => ScopeId | null;
	getDefaultProvider?: () => RepoTasksProvider | null;
};

export type ResolvedRepoTasksScope = {
	authority: "canonical";
	scopeId: ScopeId;
	scopeRoot: string;
	store: RepoTasksProvider;
};

export class RepoTasksScopeStores {
	private readonly fallbackScope: DirectoryScope;
	private readonly fallbackScopes: readonly DirectoryScope[];
	private readonly fallbackDefaultScopeId: ScopeId;
	private readonly getFallbackActiveScopeId: () => ScopeId | null;
	private readonly getDefaultProvider: (() => RepoTasksProvider | null) | undefined;
	private readonly stores = new Map<ScopeId, RepoTasksProvider>();

	constructor(options: RepoTasksScopeStoresOptions) {
		this.fallbackScope = buildDirectoryScope({
			scopeRoot: options.defaultScopeRoot,
		});
		this.fallbackScopes = options.scopes ?? [this.fallbackScope];
		const firstScope = this.fallbackScopes[0];
		if (!firstScope) {
			throw new Error("RepoTasksScopeStores requires at least one scope");
		}
		this.fallbackDefaultScopeId =
			options.defaultScopeId ?? firstScope.scopeId;
		if (
			!this.fallbackScopes.some(
				(scope) => scope.scopeId === this.fallbackDefaultScopeId,
			)
		) {
			throw new Error(
				`RepoTasksScopeStores default scope ${this.fallbackDefaultScopeId} is not registered`,
			);
		}
		this.getFallbackActiveScopeId = options.getActiveScopeId ?? (() => null);
		this.getDefaultProvider = options.getDefaultProvider;
	}

	resolve(
		scopeId: string | null | undefined,
	):
		| ({ ok: true } & ResolvedRepoTasksScope)
		| { ok: false; error: UnknownRepoTasksScopeError } {
		const snapshot = this.snapshot();
		const requested = scopeId?.trim();
		const resolvedScopeId =
			requested && requested.length > 0
				? requested
				: snapshot.activeScopeId ?? snapshot.defaultScopeId;
		const scope = snapshot.scopes.find(
			(entry) => entry.scopeId === resolvedScopeId,
		);
		if (!scope) {
			return {
				ok: false,
				error: {
					error: "Unknown scope",
					reason: "unknown_scope",
					scopeId: resolvedScopeId,
				},
			};
		}
		return {
			ok: true,
			authority: "canonical",
			scopeId: scope.scopeId,
			scopeRoot: scope.scopeRoot,
			store: this.storeFor(scope, snapshot.defaultScopeId),
		};
	}

	private snapshot(): ScopeSnapshot {
		const daemonScope = getProviderRegistry()?.get(
			DAEMON_SCOPE_PROVIDER_TYPE,
		);
		if (daemonScope) {
			const projection = daemonScope.getScopeRegistryProjection();
			return {
				defaultScopeId: projection.defaultScopeId,
				activeScopeId: daemonScope.getActiveScopeId(),
				scopes: directoryScopesFromProjection(projection),
			};
		}
		return {
			defaultScopeId: this.fallbackDefaultScopeId,
			activeScopeId: this.getFallbackActiveScopeId(),
			scopes: this.fallbackScopes,
		};
	}

	private storeFor(
		scope: DirectoryScope,
		defaultScopeId: ScopeId,
	): RepoTasksProvider {
		if (scope.scopeId === defaultScopeId) {
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
): RepoTasksScopeStores {
	return new RepoTasksScopeStores({ defaultScopeRoot, getDefaultProvider });
}
