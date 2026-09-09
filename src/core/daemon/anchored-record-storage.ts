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
import { z } from "zod";
import { ANCHORED_RECORD_STORAGE_HELPER_SOURCE } from "./anchored-record-storage-helper-source.js";

const DIRECTORY_MODE = 0o700;
const HELPER_MAX_BUFFER = 16 * 1024 * 1024;
const RECORD_PATTERN = /^[0-9a-f]{8}\.json$/;

export type AnchoredRecordIdentity = {
	dev: number;
	ino: number;
};

export type AnchoredRecordSnapshot = {
	filename: string;
	contents: string;
	identity: AnchoredRecordIdentity;
};

type HelperRequest =
  | { operation: "read"; filename: string }
  | { operation: "list" | "clear" }
  | { operation: "write"; filename: string; contents: string; expectedIdentity: AnchoredRecordIdentity | null };

const identitySchema = z.object({ dev: z.number().int().safe(), ino: z.number().int().safe() });
const snapshotSchema = z.discriminatedUnion("exists", [
  z.object({ exists: z.literal(false) }),
  z.object({ exists: z.literal(true), contents: z.string(), identity: identitySchema }),
]);
const responseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    snapshot: snapshotSchema.optional(),
    snapshots: z.array(z.object({
      filename: z.string().regex(RECORD_PATTERN),
      exists: z.literal(true),
      contents: z.string(),
      identity: identitySchema,
    })).optional(),
    identity: identitySchema.optional(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
type HelperResponse = z.infer<typeof responseSchema>;

function identity(stats: Stats): AnchoredRecordIdentity {
	return { dev: stats.dev, ino: stats.ino };
}

function sameFile(left: AnchoredRecordIdentity, right: AnchoredRecordIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function storageError(path: string, reason: string): Error {
	return new Error(`Refusing to access anchored record storage at ${path}: ${reason}`);
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

function canonicalizeRecordDirectoryPath(path: string): string {
	const requestedPath = resolve(path);
	const root = parse(requestedPath).root;
	if (requestedPath === root) {
		throw storageError(requestedPath, "record directory cannot be the filesystem root");
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
		throw storageError(path, "record directory must be owned by the daemon user");
	}
}

function prepareRecordDirectory(path: string): Array<{ path: string; identity: AnchoredRecordIdentity }> {
  const anchors: Array<{ path: string; identity: AnchoredRecordIdentity }> = [];
	if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
		throw storageError(path, "this platform cannot enforce no-follow anchored record storage");
	}
	for (const componentPath of directoryComponents(path)) {
		let stats = lstatOptional(componentPath);
		if (stats === undefined) {
			mkdirSync(componentPath, { mode: DIRECTORY_MODE });
			stats = lstatSync(componentPath);
		}
		if (stats.isSymbolicLink()) {
			throw storageError(path, `record directory must not contain symbolic links (${componentPath})`);
		}
		if (!stats.isDirectory()) {
			throw storageError(path, `record directory path component is not a directory (${componentPath})`);
		}
    anchors.push({ path: componentPath, identity: identity(stats) });
	}
	if (realpathSync.native(path) !== path) {
		throw storageError(path, "record directory must resolve to its intended path");
	}

	const pathStats = lstatSync(path);
	requireDaemonOwner(pathStats, path);
	const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	try {
		const openedStats = fstatSync(fd);
		requireDaemonOwner(openedStats, path);
		if (!openedStats.isDirectory() || !sameFile(identity(pathStats), identity(openedStats))) {
			throw storageError(path, "record directory changed while it was opened");
		}
		fchmodSync(fd, DIRECTORY_MODE);
		return anchors;
	} finally {
		closeSync(fd);
	}
}

export class AnchoredRecordStorage {
	readonly directoryPath: string;
	private readonly directoryAnchors: Array<{ path: string; identity: AnchoredRecordIdentity }>;

	constructor(path: string) {
		this.directoryPath = canonicalizeRecordDirectoryPath(path);
		this.directoryAnchors = prepareRecordDirectory(this.directoryPath);
	}

	read(filename: string): AnchoredRecordSnapshot | null {
		this.assertFilename(filename);
		const response = this.run({ operation: "read", filename });
		if (response.snapshot === undefined) {
			throw storageError(this.directoryPath, "filesystem helper omitted the record snapshot");
		}
		if (!response.snapshot.exists) return null;
		return { filename, contents: response.snapshot.contents, identity: response.snapshot.identity };
	}

	list(): AnchoredRecordSnapshot[] {
		const response = this.run({ operation: "list" });
		if (response.snapshots === undefined) {
			throw storageError(this.directoryPath, "filesystem helper omitted the record snapshots");
		}
		return response.snapshots.map((snapshot) => {
			return { filename: snapshot.filename, contents: snapshot.contents, identity: snapshot.identity };
		});
	}

	write(
		filename: string,
		contents: string,
		expectedIdentity: AnchoredRecordIdentity | null,
	): AnchoredRecordIdentity {
		this.assertFilename(filename);
		const response = this.run({ operation: "write", filename, contents, expectedIdentity });
		if (response.identity === undefined) {
			throw storageError(this.directoryPath, "filesystem helper omitted the record identity");
		}
		return response.identity;
	}

	clear(): void {
		this.run({ operation: "clear" });
	}

	private assertFilename(filename: string): void {
		if (!RECORD_PATTERN.test(filename)) {
			throw storageError(this.directoryPath, `invalid record filename ${filename}`);
		}
	}

	private run(request: HelperRequest): Extract<HelperResponse, { ok: true }> {
		const result = spawnSync(
			process.execPath,
			["--input-type=module", "--eval", ANCHORED_RECORD_STORAGE_HELPER_SOURCE],
			{
				encoding: "utf8",
				env: {},
				input: JSON.stringify({
					...request,
					directoryPath: this.directoryPath,
					directoryIdentity: this.directoryAnchors[this.directoryAnchors.length - 1]!.identity,
          directoryAnchors: this.directoryAnchors,
				}),
				maxBuffer: HELPER_MAX_BUFFER,
				windowsHide: true,
			},
		);
		if (result.error !== undefined || result.status !== 0) {
			throw storageError(this.directoryPath, "isolated record filesystem helper failed");
		}
		let response: HelperResponse;
		try {
			response = responseSchema.parse(JSON.parse(result.stdout));
		} catch {
			throw storageError(this.directoryPath, "isolated record filesystem helper returned invalid data");
		}
		if (!response.ok) throw storageError(this.directoryPath, response.reason);
		return response;
	}
}
