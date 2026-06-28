export const OKF_VERSION = "0.1";

export type OkfFrontmatterValue = string | string[];

export type OkfIssue = {
	path: string;
	message: string;
};

export type OkfLossyMapping = {
	conceptId: string;
	field: string;
	reason: string;
};

export type OkfConcept = {
	conceptId: string;
	relativePath: string;
	frontmatter: Record<string, OkfFrontmatterValue>;
	complexFields: string[];
	body: string;
	localLinks: string[];
};

export type OkfBundle = {
	root: string;
	okfVersion: string | null;
	concepts: OkfConcept[];
	reservedFiles: string[];
};

export type OkfValidationResult =
	| { ok: true; bundle: OkfBundle; errors: [] }
	| { ok: false; errors: OkfIssue[] };

export type OkfImportEntry = {
	title: string;
	content: string;
	type: string;
	tags: string[];
	status: string;
	meta: Record<string, string>;
};

export type OkfImportPlan = {
	entries: OkfImportEntry[];
	lossy: OkfLossyMapping[];
};

export type OkfExportResult = {
	count: number;
	paths: string[];
	lossy: OkfLossyMapping[];
};

export class OkfBundleError extends Error {
	readonly issues: OkfIssue[];

	constructor(issues: OkfIssue[]) {
		super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
		this.name = "OkfBundleError";
		this.issues = issues;
	}
}
