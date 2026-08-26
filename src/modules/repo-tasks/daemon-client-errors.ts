export type RepoTaskRouteErrorBody = {
	error?: string;
	reason?: string;
	scopeId?: string;
};

export function scopeQuery(scopeId: string | undefined): string {
	if (!scopeId) return "";
	const params = new URLSearchParams();
	params.set("scopeId", scopeId);
	return `?${params.toString()}`;
}

export async function readRepoTaskRouteError(
	res: Response,
): Promise<RepoTaskRouteErrorBody | null> {
	try {
		const parsed = (await res.json()) as RepoTaskRouteErrorBody;
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

export async function throwRepoTaskRouteError(
	res: Response,
	fallback: string,
): Promise<never> {
	const body = await readRepoTaskRouteError(res);
	if (body?.reason === "unknown_scope" && body.scopeId) {
		throw new Error(`Unknown scope: ${body.scopeId}`);
	}
	throw new Error(body?.error ?? fallback);
}
