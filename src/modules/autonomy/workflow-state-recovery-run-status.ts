import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunStatus } from "#core/workflow/run-types.js";
import type { TaskClaim } from "./task-claims.js";

export type OwnerRunStatus = WorkflowRunStatus | "running";

type OwnerRunMetadataProjection = {
	id?: string;
	workflow?: string;
	status?: OwnerRunStatus;
};

function isOwnerRunStatus(value: string | undefined): value is OwnerRunStatus {
	return (
		value === "running" ||
		value === "success" ||
		value === "failed" ||
		value === "interrupted" ||
		value === "completed-with-warnings"
	);
}

export function readOwnerRunStatus(
	projectDir: string,
	claim: TaskClaim,
): OwnerRunStatus | null {
	const metadata = readOptionalJsonFile<OwnerRunMetadataProjection>(
		join(projectDir, ".kota", "runs", claim.runId, "metadata.json"),
	);
	if (
		metadata === null ||
		metadata.id !== claim.runId ||
		metadata.workflow !== claim.workflowId ||
		!isOwnerRunStatus(metadata.status)
	) {
		return null;
	}
	return metadata.status;
}
