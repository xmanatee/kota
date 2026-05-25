import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { McpServerConfig } from "#core/mcp/manager.js";

export type RegistryInstallMethod = "remote" | "npm";

export type RegistryImportOptions = {
	inputs?: ReadonlyMap<string, string>;
	installMethod?: RegistryInstallMethod;
	serverKey?: string;
};

export type RegistryServerConfigResult = {
	serverKey: string;
	config: McpServerConfig;
};

type RegistryServerDetail = {
	name: string;
	version: string;
	remotes: RegistryRemoteTransport[];
	packages: RegistryPackage[];
};

type RegistryRemoteTransport = {
	type: string;
	url: string;
	variables: Map<string, RegistryInput>;
	headers: RegistryHeaderInput[];
};

type RegistryPackage = {
	registryType: string;
	registryBaseUrl?: string;
	identifier: string;
	version?: string;
	runtimeHint?: string;
	transportType: string;
	runtimeArguments: RegistryArgument[];
	packageArguments: RegistryArgument[];
	environmentVariables: RegistryHeaderInput[];
};

type RegistryInput = {
	value?: string;
	defaultValue?: string;
	isRequired: boolean;
};

type RegistryHeaderInput = RegistryInput & {
	name: string;
};

type RegistryArgument =
	| (RegistryInput & {
			type: "positional";
			valueHint?: string;
			isRepeated: boolean;
	  })
	| (RegistryInput & {
			type: "named";
			name: string;
			isRepeated: boolean;
	  });

type RegistryChoice = {
	method: RegistryInstallMethod;
	label: string;
	build: () => McpServerConfig;
};

export class RegistryImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RegistryImportError";
	}
}

export function resolveRegistryServerConfig(
	response: KotaJsonValue,
	options: RegistryImportOptions = {},
): RegistryServerConfigResult {
	const server = parseRegistryServer(response);
	rejectInactiveStatus(response, server);
	const choices = collectChoices(server, options.inputs ?? new Map());
	const selectedChoices = options.installMethod
		? choices.supported.filter((choice) => choice.method === options.installMethod)
		: choices.supported;

	if (selectedChoices.length === 0) {
		const methodSuffix = options.installMethod
			? ` for --install-method ${options.installMethod}`
			: "";
		throw new RegistryImportError(
			`Registry server ${server.name}@${server.version} has no supported install choice${methodSuffix}: ${choices.unsupported.join("; ")}`,
		);
	}
	if (selectedChoices.length > 1) {
		const labels = selectedChoices.map((choice) => choice.label).join(", ");
		throw new RegistryImportError(
			`Registry server ${server.name}@${server.version} has multiple supported install choices: ${labels}; pass --install-method remote or --install-method npm`,
		);
	}

	return {
		serverKey: options.serverKey ?? defaultServerKey(server.name),
		config: selectedChoices[0].build(),
	};
}

function collectChoices(
	server: RegistryServerDetail,
	inputs: ReadonlyMap<string, string>,
): { supported: RegistryChoice[]; unsupported: string[] } {
	const supported: RegistryChoice[] = [];
	const unsupported: string[] = [];

	for (const remote of server.remotes) {
		if (remote.type !== "streamable-http") {
			unsupported.push(
				`remote transport ${remote.type} is unsupported; supported remote transport is streamable-http`,
			);
			continue;
		}
		supported.push({
			method: "remote",
			label: "remote streamable-http",
			build: () => buildRemoteConfig(server, remote, inputs),
		});
	}

	for (const registryPackage of server.packages) {
		if (registryPackage.registryType !== "npm") {
			unsupported.push(
				`package registryType ${registryPackage.registryType} is unsupported; supported package registryType is npm`,
			);
			continue;
		}
		if (registryPackage.transportType !== "stdio") {
			unsupported.push(
				`npm package transport ${registryPackage.transportType} is unsupported; supported package transport is stdio`,
			);
			continue;
		}
		supported.push({
			method: "npm",
			label: "npm stdio",
			build: () => buildNpmConfig(server, registryPackage, inputs),
		});
	}

	if (supported.length === 0 && unsupported.length === 0) {
		unsupported.push("server metadata does not declare remotes or packages");
	}

	return { supported, unsupported };
}

function buildRemoteConfig(
	server: RegistryServerDetail,
	remote: RegistryRemoteTransport,
	inputs: ReadonlyMap<string, string>,
): McpServerConfig {
	const missing: string[] = [];
	const url = resolveRemoteUrl(remote, inputs, missing);
	const headers = resolveHeaderInputs(remote.headers, inputs, missing);
	throwIfMissingInputs(server, missing);
	const config: McpServerConfig = {
		type: "http",
		url,
		...(Object.keys(headers).length > 0 ? { headers } : {}),
	};
	return config;
}

function buildNpmConfig(
	server: RegistryServerDetail,
	registryPackage: RegistryPackage,
	inputs: ReadonlyMap<string, string>,
): McpServerConfig {
	const missing: string[] = [];
	const packageVersion = registryPackage.version ?? server.version;
	const packageSpecifier = `${registryPackage.identifier}@${packageVersion}`;
	const runtimeArguments = resolveArguments(
		registryPackage.runtimeArguments,
		inputs,
		missing,
	);
	const packageArguments = resolveArguments(
		registryPackage.packageArguments,
		inputs,
		missing,
	);
	const env = resolveHeaderInputs(
		registryPackage.environmentVariables,
		inputs,
		missing,
	);
	throwIfMissingInputs(server, missing);

	const args = buildPnpmDlxArgs(
		registryPackage.registryBaseUrl,
		runtimeArguments,
		packageSpecifier,
		packageArguments,
	);

	const config: McpServerConfig = {
		command: "pnpm",
		args,
		...(Object.keys(env).length > 0 ? { env } : {}),
	};
	return config;
}

function buildPnpmDlxArgs(
	registryBaseUrl: string | undefined,
	runtimeArguments: string[],
	packageSpecifier: string,
	packageArguments: string[],
): string[] {
	const args: string[] = [];
	if (registryBaseUrl && registryBaseUrl !== "https://registry.npmjs.org") {
		args.push("--registry", registryBaseUrl);
	}
	args.push("dlx", ...runtimeArguments, packageSpecifier, ...packageArguments);
	return args;
}

function resolveRemoteUrl(
	remote: RegistryRemoteTransport,
	inputs: ReadonlyMap<string, string>,
	missing: string[],
): string {
	const resolved = remote.url.replace(
		/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
		(match, name: string) => {
			const input = remote.variables.get(name);
			if (!input) {
				missing.push(name);
				return match;
			}
			const value = resolveInputValue(input, name, inputs, missing);
			return value ?? match;
		},
	);
	if (missing.length > 0) return resolved;
	try {
		const parsed = new URL(resolved);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new RegistryImportError(`remote URL must use http or https: ${resolved}`);
		}
		return parsed.toString();
	} catch (error) {
		if (error instanceof RegistryImportError) throw error;
		throw new RegistryImportError(`remote URL is not valid after input resolution: ${resolved}`);
	}
}

function resolveHeaderInputs(
	headers: RegistryHeaderInput[],
	inputs: ReadonlyMap<string, string>,
	missing: string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const header of headers) {
		const value = resolveInputValue(header, header.name, inputs, missing);
		if (value !== undefined) out[header.name] = value;
	}
	return out;
}

function resolveArguments(
	args: RegistryArgument[],
	inputs: ReadonlyMap<string, string>,
	missing: string[],
): string[] {
	const resolved: string[] = [];
	for (const arg of args) {
		if (arg.isRepeated) {
			throw new RegistryImportError("repeated registry arguments are not supported");
		}
		if (arg.type === "positional") {
			const key = arg.valueHint ?? "positional";
			const value = resolveInputValue(arg, key, inputs, missing);
			if (value !== undefined) resolved.push(value);
			continue;
		}
		const value = resolveInputValue(arg, arg.name, inputs, missing);
		if (value !== undefined) resolved.push(`${arg.name}=${value}`);
	}
	return resolved;
}

function resolveInputValue(
	input: RegistryInput,
	key: string,
	inputs: ReadonlyMap<string, string>,
	missing: string[],
): string | undefined {
	if (input.value !== undefined) {
		return substituteInputTemplate(input.value, inputs, missing);
	}
	const provided = inputs.get(key);
	if (provided !== undefined) return provided;
	if (input.defaultValue !== undefined) return input.defaultValue;
	if (input.isRequired) missing.push(key);
	return undefined;
}

function substituteInputTemplate(
	value: string,
	inputs: ReadonlyMap<string, string>,
	missing: string[],
): string {
	return value.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, name: string) => {
		const provided = inputs.get(name);
		if (provided === undefined) {
			missing.push(name);
			return match;
		}
		return provided;
	});
}

function throwIfMissingInputs(server: RegistryServerDetail, missing: string[]): void {
	if (missing.length === 0) return;
	throw new RegistryImportError(
		`Registry server ${server.name}@${server.version} requires operator input: ${unique(missing).join(", ")}`,
	);
}

function rejectInactiveStatus(
	response: KotaJsonValue,
	server: RegistryServerDetail,
): void {
	const root = requireObject(response, "registry response");
	const meta = optionalObject(root._meta, "registry response._meta");
	const official = meta
		? optionalObject(
				meta["io.modelcontextprotocol.registry/official"],
				"registry response._meta.io.modelcontextprotocol.registry/official",
			)
		: undefined;
	const status = official ? optionalString(official.status, "registry status") : undefined;
	if (status === undefined || status === "active") return;
	if (status === "deprecated" || status === "deleted") {
		throw new RegistryImportError(
			`Registry server ${server.name}@${server.version} is ${status}`,
		);
	}
	throw new RegistryImportError(
		`Registry server ${server.name}@${server.version} has unsupported registry status ${status}`,
	);
}

function parseRegistryServer(response: KotaJsonValue): RegistryServerDetail {
	const root = requireObject(response, "registry response");
	const server = requireObject(root.server, "registry response.server");
	return {
		name: requiredString(server.name, "server.name"),
		version: requiredString(server.version, "server.version"),
		remotes: optionalObjectArray(server.remotes, "server.remotes").map(parseRemote),
		packages: optionalObjectArray(server.packages, "server.packages").map(parsePackage),
	};
}

function parseRemote(value: KotaJsonObject): RegistryRemoteTransport {
	return {
		type: requiredString(value.type, "remote.type"),
		url: requiredString(value.url, "remote.url"),
		variables: parseInputMap(value.variables, "remote.variables"),
		headers: optionalObjectArray(value.headers, "remote.headers").map(parseNamedInput),
	};
}

function parsePackage(value: KotaJsonObject): RegistryPackage {
	const transport = requireObject(value.transport, "package.transport");
	const runtimeHint = optionalString(value.runtimeHint, "package.runtimeHint");
	if (runtimeHint !== undefined && runtimeHint !== "npx") {
		throw new RegistryImportError(`npm package runtimeHint ${runtimeHint} is unsupported`);
	}
	return {
		registryType: requiredString(value.registryType, "package.registryType"),
		registryBaseUrl: optionalString(value.registryBaseUrl, "package.registryBaseUrl"),
		identifier: requiredString(value.identifier, "package.identifier"),
		version: optionalString(value.version, "package.version"),
		runtimeHint,
		transportType: requiredString(transport.type, "package.transport.type"),
		runtimeArguments: optionalObjectArray(value.runtimeArguments, "package.runtimeArguments").map(
			parseArgument,
		),
		packageArguments: optionalObjectArray(value.packageArguments, "package.packageArguments").map(
			parseArgument,
		),
		environmentVariables: optionalObjectArray(
			value.environmentVariables,
			"package.environmentVariables",
		).map(parseNamedInput),
	};
}

function parseArgument(value: KotaJsonObject): RegistryArgument {
	const common = parseInput(value, "argument");
	const type = requiredString(value.type, "argument.type");
	const isRepeated = optionalBoolean(value.isRepeated, "argument.isRepeated") ?? false;
	if (type === "positional") {
		const valueHint = optionalString(value.valueHint, "argument.valueHint");
		if (common.value === undefined && valueHint === undefined) {
			throw new RegistryImportError("positional registry argument requires value or valueHint");
		}
		return {
			...common,
			type,
			...(valueHint !== undefined ? { valueHint } : {}),
			isRepeated,
		};
	}
	if (type === "named") {
		return {
			...common,
			type,
			name: requiredString(value.name, "argument.name"),
			isRepeated,
		};
	}
	throw new RegistryImportError(`registry argument type ${type} is unsupported`);
}

function parseNamedInput(value: KotaJsonObject): RegistryHeaderInput {
	return {
		...parseInput(value, "input"),
		name: requiredString(value.name, "input.name"),
	};
}

function parseInputMap(
	value: KotaJsonValue | undefined,
	label: string,
): Map<string, RegistryInput> {
	const map = new Map<string, RegistryInput>();
	if (value === undefined) return map;
	const raw = requireObject(value, label);
	for (const [key, entry] of Object.entries(raw)) {
		map.set(key, parseInput(requireObject(entry, `${label}.${key}`), `${label}.${key}`));
	}
	return map;
}

function parseInput(value: KotaJsonObject, label: string): RegistryInput {
	if (value.variables !== undefined) {
		throw new RegistryImportError(`${label}.variables is not supported during config import`);
	}
	return {
		value: optionalString(value.value, `${label}.value`),
		defaultValue: optionalString(value.default, `${label}.default`),
		isRequired: optionalBoolean(value.isRequired, `${label}.isRequired`) ?? false,
	};
}

function defaultServerKey(name: string): string {
	const lastSegment = name.split("/").at(-1) ?? name;
	const normalized = lastSegment.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return normalized.length > 0 ? normalized : "mcp-server";
}

function optionalObjectArray(
	value: KotaJsonValue | undefined,
	label: string,
): KotaJsonObject[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new RegistryImportError(`${label} must be an array`);
	}
	return value.map((entry, index) => requireObject(entry, `${label}[${index}]`));
}

function optionalObject(
	value: KotaJsonValue | undefined,
	label: string,
): KotaJsonObject | undefined {
	if (value === undefined) return undefined;
	return requireObject(value, label);
}

function requireObject(value: KotaJsonValue | undefined, label: string): KotaJsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RegistryImportError(`${label} must be an object`);
	}
	return value;
}

function requiredString(value: KotaJsonValue | undefined, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new RegistryImportError(`${label} must be a non-empty string`);
	}
	return value;
}

function optionalString(value: KotaJsonValue | undefined, label: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new RegistryImportError(`${label} must be a string`);
	}
	return value;
}

function optionalBoolean(value: KotaJsonValue | undefined, label: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		throw new RegistryImportError(`${label} must be a boolean`);
	}
	return value;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
