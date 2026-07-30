import { spawnSync } from "node:child_process";
import {
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	realpathSync,
	type Stats,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { APPROVAL_RECORD_STORAGE_HELPER_SOURCE } from "./approval-record-storage-helper-source.js";

const DIRECTORY_MODE = 0o700;
const HELPER_MAX_BUFFER = 16 * 1024 * 1024;
const RECORD_PATTERN = /^[0-9a-f]{8}\.json$/;

export type ApprovalFileIdentity = {
	dev: number;
	ino: number;
};

export type ApprovalRecordSnapshot = {
	filename: string;
	contents: string;
	identity: ApprovalFileIdentity;
};

type HelperRequest = {
	operation: "read" | "list" | "write" | "clear";
	directoryPath: string;
	directoryIdentity: ApprovalFileIdentity;
	filename?: string;
	contents?: string;
	expectedIdentity?: ApprovalFileIdentity | null;
};

type HelperSnapshot =
	| { exists: false }
	| { exists: true; contents: string; identity: ApprovalFileIdentity };

type HelperResponse =
	| {
			ok: true;
			snapshot?: HelperSnapshot;
			snapshots?: Array<HelperSnapshot & { filename: string }>;
			identity?: ApprovalFileIdentity;
	  }
	| { ok: false; reason: string };

function identity(stats: Stats): ApprovalFileIdentity {
	return { dev: stats.dev, ino: stats.ino };
}

function sameFile(left: ApprovalFileIdentity, right: ApprovalFileIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function storageError(path: string, reason: string): Error {
	return new Error(`Refusing to access approval storage at ${path}: ${reason}`);
}

function lstatOptional(path: string): Stats | undefined {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

function directoryComponents(path: string): string[] {
	const root = parse(path).root;
	const paths: string[] = [];
	let current = root;
	for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
		current = join(current, component);
		paths.push(current);
	}
	return paths;
}

function canonicalizeApprovalDirectoryPath(path: string): string {
	const requestedPath = resolve(path);
	const root = parse(requestedPath).root;
	if (requestedPath === root) {
		throw storageError(requestedPath, "approval directory cannot be the filesystem root");
	}

	const missingParents: string[] = [];
	let existingParent = dirname(requestedPath);
	while (lstatOptional(existingParent) === undefined) {
		missingParents.unshift(basename(existingParent));
		existingParent = dirname(existingParent);
	}

	return join(
		realpathSync.native(existingParent),
		...missingParents,
		basename(requestedPath),
	);
}

function requireDaemonOwner(stats: Stats, path: string): void {
	if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
		throw storageError(path, "approval directory must be owned by the daemon user");
	}
}

function prepareApprovalDirectory(path: string): ApprovalFileIdentity {
	if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
		throw storageError(path, "this platform cannot enforce no-follow approval storage");
	}
	for (const componentPath of directoryComponents(path)) {
		let stats = lstatOptional(componentPath);
		if (stats === undefined) {
			mkdirSync(componentPath, { mode: DIRECTORY_MODE });
			stats = lstatSync(componentPath);
		}
		if (stats.isSymbolicLink()) {
			throw storageError(path, `approval directory must not contain symbolic links (${componentPath})`);
		}
		if (!stats.isDirectory()) {
			throw storageError(path, `approval directory path component is not a directory (${componentPath})`);
		}
	}
	if (realpathSync.native(path) !== path) {
		throw storageError(path, "approval directory must resolve to its intended path");
	}

	const pathStats = lstatSync(path);
	requireDaemonOwner(pathStats, path);
	const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	try {
		const openedStats = fstatSync(fd);
		requireDaemonOwner(openedStats, path);
		if (!openedStats.isDirectory() || !sameFile(identity(pathStats), identity(openedStats))) {
			throw storageError(path, "approval directory changed while it was opened");
		}
		fchmodSync(fd, DIRECTORY_MODE);
		return identity(openedStats);
	} finally {
		closeSync(fd);
	}
}

export class ApprovalRecordStorage {
	readonly directoryPath: string;
	private readonly directoryIdentity: ApprovalFileIdentity;

	constructor(path: string) {
		this.directoryPath = canonicalizeApprovalDirectoryPath(path);
		this.directoryIdentity = prepareApprovalDirectory(this.directoryPath);
	}

	read(filename: string): ApprovalRecordSnapshot | null {
		this.assertFilename(filename);
		const response = this.run({ operation: "read", filename });
		if (response.snapshot === undefined) {
			throw storageError(this.directoryPath, "filesystem helper omitted the approval snapshot");
		}
		if (!response.snapshot.exists) return null;
		return { filename, ...response.snapshot };
	}

	list(): ApprovalRecordSnapshot[] {
		const response = this.run({ operation: "list" });
		if (response.snapshots === undefined) {
			throw storageError(this.directoryPath, "filesystem helper omitted the approval snapshots");
		}
		return response.snapshots.map((snapshot) => {
			if (!snapshot.exists) {
				throw storageError(this.directoryPath, "filesystem helper listed a missing approval record");
			}
			return { filename: snapshot.filename, contents: snapshot.contents, identity: snapshot.identity };
		});
	}

	write(
		filename: string,
		contents: string,
		expectedIdentity: ApprovalFileIdentity | null,
	): ApprovalFileIdentity {
		this.assertFilename(filename);
		const response = this.run({ operation: "write", filename, contents, expectedIdentity });
		if (response.identity === undefined) {
			throw storageError(this.directoryPath, "filesystem helper omitted the approval identity");
		}
		return response.identity;
	}

	clear(): void {
		this.run({ operation: "clear" });
	}

	private assertFilename(filename: string): void {
		if (!RECORD_PATTERN.test(filename)) {
			throw storageError(this.directoryPath, `invalid approval record filename ${filename}`);
		}
	}

	private run(request: Omit<HelperRequest, "directoryPath" | "directoryIdentity">): Extract<HelperResponse, { ok: true }> {
		const result = spawnSync(
			process.execPath,
			["--input-type=module", "--eval", APPROVAL_RECORD_STORAGE_HELPER_SOURCE],
			{
				encoding: "utf8",
				env: {},
				input: JSON.stringify({
					...request,
					directoryPath: this.directoryPath,
					directoryIdentity: this.directoryIdentity,
				}),
				maxBuffer: HELPER_MAX_BUFFER,
				windowsHide: true,
			},
		);
		if (result.error !== undefined || result.status !== 0) {
			throw storageError(this.directoryPath, "isolated approval filesystem helper failed");
		}
		let response: HelperResponse;
		try {
			response = JSON.parse(result.stdout) as HelperResponse;
		} catch {
			throw storageError(this.directoryPath, "isolated approval filesystem helper returned invalid data");
		}
		if (!response.ok) throw storageError(this.directoryPath, response.reason);
		return response;
	}
}
