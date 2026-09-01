import type { DaemonScopeProvider } from "#core/daemon/scope-provider.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import {
	buildDirectoryScope,
	type DirectoryScope,
	directoryScopesFromProjection,
	type ScopeId,
} from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { MemoryProvider } from "#core/modules/provider-types.js";
import { getScopeMemoryStore } from "./store.js";

export type UnknownMemoryScopeError = {
	error: "Unknown scope";
	reason: "unknown_scope";
	scopeId: string;
};

type ScopeSnapshot = {
	defaultScopeId: ScopeId;
	activeScopeId: ScopeId | null;
	scopes: readonly DirectoryScope[];
};

export type MemoryScopeStoresOptions = {
	defaultScopeRoot: string;
	scopes?: readonly DirectoryScope[];
	defaultScopeId?: ScopeId;
	getActiveScopeId?: () => ScopeId | null;
	getDefaultProvider?: () => MemoryProvider | null;
	getDaemonScopeProvider?: () => DaemonScopeProvider | null;
};

export class MemoryScopeStores {
	private readonly fallbackScope: DirectoryScope;
	private readonly fallbackScopes: readonly DirectoryScope[];
	private readonly fallbackDefaultScopeId: ScopeId;
	private readonly getFallbackActiveScopeId: () => ScopeId | null;
	private readonly getDefaultProvider: (() => MemoryProvider | null) | undefined;
	private readonly getDaemonScopeProvider: () => DaemonScopeProvider | null;
	private readonly stores = new Map<ScopeId, MemoryProvider>();

	constructor(options: MemoryScopeStoresOptions) {
		this.fallbackScope = buildDirectoryScope({
			scopeRoot: options.defaultScopeRoot,
		});
		this.fallbackScopes = options.scopes ?? [this.fallbackScope];
		const firstScope = this.fallbackScopes[0];
		if (!firstScope) {
			throw new Error("MemoryScopeStores requires at least one scope");
		}
		this.fallbackDefaultScopeId =
			options.defaultScopeId ?? firstScope.scopeId;
		if (
			!this.fallbackScopes.some(
				(scope) => scope.scopeId === this.fallbackDefaultScopeId,
			)
		) {
			throw new Error(
				`MemoryScopeStores default scope ${this.fallbackDefaultScopeId} is not registered`,
			);
		}
		this.getFallbackActiveScopeId = options.getActiveScopeId ?? (() => null);
		this.getDefaultProvider = options.getDefaultProvider;
		this.getDaemonScopeProvider = options.getDaemonScopeProvider
			?? (() => getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE) ?? null);
	}

	resolve(
		scopeId: string | null | undefined,
	):
		| { ok: true; scopeId: ScopeId; scopeRoot: string; store: MemoryProvider }
		| { ok: false; error: UnknownMemoryScopeError } {
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
			scopeId: scope.scopeId,
			scopeRoot: scope.scopeRoot,
			store: this.storeFor(scope, snapshot.defaultScopeId),
		};
	}

	private snapshot(): ScopeSnapshot {
		const daemonScope = this.getDaemonScopeProvider();
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
	): MemoryProvider {
		if (scope.scopeId === defaultScopeId) {
			const provider = this.getDefaultProvider?.();
			if (provider) return provider;
		}
		const existing = this.stores.get(scope.scopeId);
		if (existing) return existing;
		const store = getScopeMemoryStore(scope.scopeRoot);
		this.stores.set(scope.scopeId, store);
		return store;
	}
}

export function createMemoryScopeStores(
	defaultScopeRoot: string,
	getDefaultProvider?: () => MemoryProvider | null,
	getDaemonScopeProvider?: () => DaemonScopeProvider | null,
): MemoryScopeStores {
	return new MemoryScopeStores({ defaultScopeRoot, getDefaultProvider, getDaemonScopeProvider });
}
