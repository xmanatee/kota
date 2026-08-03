export type RepoTaskRouteErrorBody = {
	error?: string;
	reason?: string;
	projectId?: string;
};

export function projectQuery(projectId: string | undefined): string {
	if (!projectId) return "";
	const params = new URLSearchParams();
	params.set("projectId", projectId);
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
	if (body?.reason === "unknown_project" && body.projectId) {
		throw new Error(`Unknown project: ${body.projectId}`);
	}
	throw new Error(body?.error ?? fallback);
}
