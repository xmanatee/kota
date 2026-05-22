import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP_REGISTRY_SCHEMA_URL =
	"https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..", "..", "..");

type McpRegistryRepository = {
	source: "github";
	url: string;
};

type McpRegistryPackage = {
	registryType: "npm";
	identifier: string;
	version: string;
	transport: {
		type: "stdio";
	};
	packageArguments: McpRegistryPackageArgument[];
};

type McpRegistryRemote = {
	type: "streamable-http" | "sse";
	url: string;
};

type McpRegistryPackageArgument = {
	type: "positional";
	value: string;
};

export type McpRegistryServerJson = {
	$schema: string;
	name: string;
	title?: string;
	description: string;
	repository: McpRegistryRepository;
	version: string;
	packages: McpRegistryPackage[];
	remotes?: McpRegistryRemote[];
};

const MCP_SERVER_PACKAGE_ARGUMENTS: McpRegistryPackageArgument[] = [
	{ type: "positional", value: "mcp-server" },
];

export type McpRegistryPackageJson = {
	name: string;
	version: string;
	mcpName: string;
};

export type McpRegistryMetadata = {
	packageJson: McpRegistryPackageJson;
	serverJson: McpRegistryServerJson;
};

export function readMcpRegistryMetadata(projectRoot = REPO_ROOT): McpRegistryMetadata {
	return {
		packageJson: readJsonFile<McpRegistryPackageJson>(join(projectRoot, "package.json")),
		serverJson: readJsonFile<McpRegistryServerJson>(join(projectRoot, "server.json")),
	};
}

export function validateMcpRegistryMetadata(metadata: McpRegistryMetadata): string[] {
	const errors: string[] = [];
	const { packageJson, serverJson } = metadata;

	if (serverJson.$schema !== MCP_REGISTRY_SCHEMA_URL) {
		errors.push(
			`server.json.$schema "${serverJson.$schema}" must equal "${MCP_REGISTRY_SCHEMA_URL}"`,
		);
	}
	if (serverJson.name !== packageJson.mcpName) {
		errors.push(
			`server.json.name "${serverJson.name}" must equal package.json.mcpName "${packageJson.mcpName}"`,
		);
	}
	if (serverJson.version !== packageJson.version) {
		errors.push(
			`server.json.version "${serverJson.version}" must equal package.json.version "${packageJson.version}"`,
		);
	}
	if (serverJson.repository.url !== "https://github.com/xmanatee/kota") {
		errors.push(
			`server.json.repository.url "${serverJson.repository.url}" must equal "https://github.com/xmanatee/kota"`,
		);
	}

	validatePackageEntry(errors, packageJson, serverJson.packages[0]);
	validatePublicRemotes(errors, serverJson.remotes ?? []);

	return errors;
}

function validatePackageEntry(
	errors: string[],
	packageJson: McpRegistryPackageJson,
	packageEntry: McpRegistryPackage | undefined,
): void {
	if (!packageEntry) {
		errors.push("server.json.packages[0] is required");
		return;
	}
	if (packageEntry.registryType !== "npm") {
		errors.push(
			`server.json.packages[0].registryType "${packageEntry.registryType}" must equal "npm"`,
		);
	}
	if (packageEntry.identifier !== packageJson.name) {
		errors.push(
			`server.json.packages[0].identifier "${packageEntry.identifier}" must equal package.json.name "${packageJson.name}"`,
		);
	}
	if (packageEntry.version !== packageJson.version) {
		errors.push(
			`server.json.packages[0].version "${packageEntry.version}" must equal package.json.version "${packageJson.version}"`,
		);
	}
	if (packageEntry.transport.type !== "stdio") {
		errors.push(
			`server.json.packages[0].transport.type "${packageEntry.transport.type}" must equal "stdio"`,
		);
	}
	if (
		!Array.isArray(packageEntry.packageArguments) ||
		!packageArgumentsEqual(packageEntry.packageArguments, MCP_SERVER_PACKAGE_ARGUMENTS)
	) {
		errors.push(
			`server.json.packages[0].packageArguments must equal ${JSON.stringify(MCP_SERVER_PACKAGE_ARGUMENTS)}`,
		);
	}
}

function validatePublicRemotes(errors: string[], remotes: McpRegistryRemote[]): void {
	remotes.forEach((remote, index) => {
		const url = parseUrl(remote.url);
		if (!url || !isPublicHttpsEndpoint(url)) {
			errors.push(
				`server.json.remotes[${index}].url "${remote.url}" must be a public HTTPS endpoint`,
			);
			return;
		}
		if (url.username || url.password) {
			errors.push(
				`server.json.remotes[${index}].url "${remote.url}" must not include credentials`,
			);
		}
		if (hasSecretLikeQueryParameter(url)) {
			errors.push(
				`server.json.remotes[${index}].url "${remote.url}" must not include secret-like query parameters`,
			);
		}
	});
}

function parseUrl(rawUrl: string): URL | null {
	try {
		return new URL(rawUrl);
	} catch {
		return null;
	}
}

function isPublicHttpsEndpoint(url: URL): boolean {
	if (url.protocol !== "https:") return false;
	const host = normalizeDnsHostname(url.hostname.toLowerCase());
	if (!host.includes(".")) return false;
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host.endsWith(".lan") ||
		host.endsWith(".home") ||
		host.endsWith(".corp")
	) {
		return false;
	}

	const ipVersion = isIP(host);
	if (ipVersion === 4) return isPublicIpv4(host);
	if (ipVersion === 6) return isPublicIpv6(host);
	return true;
}

function hasSecretLikeQueryParameter(url: URL): boolean {
	for (const key of url.searchParams.keys()) {
		if (/authorization|api[-_]?key|credential|password|secret|token/i.test(key)) {
			return true;
		}
	}
	return false;
}

function normalizeDnsHostname(host: string): string {
	return host.replace(/\.+$/, "");
}

function isPublicIpv4(host: string): boolean {
	const address = ipv4ToNumber(host);
	return !NON_PUBLIC_IPV4_RANGES.some(([base, prefixLength]) =>
		ipv4RangeContains(base, prefixLength, address),
	);
}

function isPublicIpv6(host: string): boolean {
	if (host === "::1") return false;
	if (host.startsWith("fc") || host.startsWith("fd")) return false;
	if (
		host.startsWith("fe8") ||
		host.startsWith("fe9") ||
		host.startsWith("fea") ||
		host.startsWith("feb")
	) {
		return false;
	}
	return true;
}

function readJsonFile<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function packageArgumentsEqual(
	actual: McpRegistryPackageArgument[],
	expected: McpRegistryPackageArgument[],
): boolean {
	if (actual.length !== expected.length) return false;
	return actual.every(
		(argument, index) =>
			argument.type === expected[index]!.type && argument.value === expected[index]!.value,
	);
}

function ipv4ToNumber(host: string): number {
	const octets = host.split(".").map((part) => Number.parseInt(part, 10));
	return (
		octets[0]! * 256 ** 3 +
		octets[1]! * 256 ** 2 +
		octets[2]! * 256 +
		octets[3]!
	);
}

function ipv4RangeContains(base: number, prefixLength: number, address: number): boolean {
	const blockSize = 2 ** (32 - prefixLength);
	return address >= base && address < base + blockSize;
}

const NON_PUBLIC_IPV4_RANGES: Array<[base: number, prefixLength: number]> = [
	[ipv4ToNumber("0.0.0.0"), 8],
	[ipv4ToNumber("10.0.0.0"), 8],
	[ipv4ToNumber("100.64.0.0"), 10],
	[ipv4ToNumber("127.0.0.0"), 8],
	[ipv4ToNumber("169.254.0.0"), 16],
	[ipv4ToNumber("172.16.0.0"), 12],
	[ipv4ToNumber("192.0.0.0"), 24],
	[ipv4ToNumber("192.0.2.0"), 24],
	[ipv4ToNumber("192.88.99.0"), 24],
	[ipv4ToNumber("192.168.0.0"), 16],
	[ipv4ToNumber("198.18.0.0"), 15],
	[ipv4ToNumber("198.51.100.0"), 24],
	[ipv4ToNumber("203.0.113.0"), 24],
	[ipv4ToNumber("224.0.0.0"), 4],
	[ipv4ToNumber("240.0.0.0"), 4],
];
