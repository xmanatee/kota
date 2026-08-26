import { Command, InvalidArgumentError } from "commander";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { McpRegistryModuleConfig } from "./private-tunnel.js";
import { buildPrivateTunnelCommand } from "./private-tunnel-cli.js";
import {
	privateTunnelConfigSchema,
	privateTunnelSetupRequirements,
} from "./private-tunnel-setup.js";
import {
	RegistryImportError,
	type RegistryImportOptions,
	type RegistryInstallMethod,
	resolveRegistryServerConfig,
} from "./registry-import.js";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io";

type FetchRegistry = (url: string) => Promise<Response>;

type Writable = {
	write(chunk: string): void;
};

type McpRegistryCommandDeps = {
	fetchRegistry?: FetchRegistry;
	getConfig?: () => McpRegistryModuleConfig | undefined;
	getSecret?: (name: string) => string | null;
	stdout?: Writable;
	stderr?: Writable;
};

type ImportCommandOptions = {
	serverVersion: string;
	registryUrl: string;
	serverKey?: string;
	installMethod?: string;
	input: string[];
};

export function buildMcpRegistryCommand(
	deps: McpRegistryCommandDeps = {},
): Command {
	const fetchRegistry = deps.fetchRegistry ?? globalThis.fetch.bind(globalThis);
	const getConfig = deps.getConfig ?? (() => undefined);
	const getSecret = deps.getSecret ?? (() => null);
	const stdout = deps.stdout ?? process.stdout;
	const stderr = deps.stderr ?? process.stderr;
	const cmd = new Command("mcp-registry").description(
		"Import external MCP server config from an MCP Registry-compatible endpoint",
	);

	cmd
		.command("import <serverName>")
		.description("Resolve one registry server version to KOTA mcpServers JSON")
		.option("--server-version <version>", "Registry server version", "latest")
		.option("--registry-url <url>", "MCP Registry-compatible base URL", DEFAULT_REGISTRY_URL)
		.option("--server-key <name>", "mcpServers key to emit")
		.option(
			"--install-method <method>",
			"Install method to select when metadata has multiple supported choices: remote or npm",
			parseInstallMethod,
		)
		.option(
			"--input <name=value>",
			"Operator input for registry variables, headers, arguments, or env values",
			collectInput,
			[],
		)
		.action(async (serverName: string, opts: ImportCommandOptions) => {
			try {
				const response = await fetchRegistryServer({
					fetchRegistry,
					registryUrl: opts.registryUrl,
					serverName,
					version: opts.serverVersion,
				});
				const importOptions: RegistryImportOptions = {
					inputs: parseInputAssignments(opts.input),
					...(opts.installMethod
						? { installMethod: opts.installMethod as RegistryInstallMethod }
						: {}),
					...(opts.serverKey ? { serverKey: opts.serverKey } : {}),
				};
				const result = resolveRegistryServerConfig(response, importOptions);
				stdout.write(
					`${JSON.stringify({ mcpServers: { [result.serverKey]: result.config } }, null, 2)}\n`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				stderr.write(`Error: ${message}\n`);
				process.exitCode = 1;
			}
		});

	cmd.addCommand(buildPrivateTunnelCommand({ getConfig, getSecret, stdout, stderr }));

	return cmd;
}

type FetchRegistryServerArgs = {
	fetchRegistry: FetchRegistry;
	registryUrl: string;
	serverName: string;
	version: string;
};

export async function fetchRegistryServer(
	args: FetchRegistryServerArgs,
): Promise<KotaJsonValue> {
	const url = registryServerVersionUrl(args.registryUrl, args.serverName, args.version);
	const response = await args.fetchRegistry(url);
	const body = await response.text();
	if (!response.ok) {
		throw new RegistryImportError(
			`Registry request failed: GET ${url} returned HTTP ${response.status}${body ? `: ${body}` : ""}`,
		);
	}
	try {
		return JSON.parse(body) as KotaJsonValue;
	} catch {
		throw new RegistryImportError(`Registry response was not valid JSON: ${url}`);
	}
}

export function registryServerVersionUrl(
	registryUrl: string,
	serverName: string,
	version: string,
): string {
	const base = registryUrl.replace(/\/+$/g, "");
	const parsed = new URL(base);
	parsed.pathname = `${parsed.pathname.replace(/\/+$/g, "")}/v0.1/servers/${encodeURIComponent(serverName)}/versions/${encodeURIComponent(version)}`;
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

function parseInstallMethod(value: string): RegistryInstallMethod {
	if (value === "remote" || value === "npm") return value;
	throw new InvalidArgumentError("install method must be remote or npm");
}

function collectInput(value: string, previous: string[]): string[] {
	return [...previous, value];
}

function parseInputAssignments(values: string[]): Map<string, string> {
	const inputs = new Map<string, string>();
	for (const value of values) {
		const separator = value.indexOf("=");
		if (separator <= 0) {
			throw new RegistryImportError(`input must use name=value syntax: ${value}`);
		}
		const key = value.slice(0, separator);
		inputs.set(key, value.slice(separator + 1));
	}
	return inputs;
}

const mcpRegistryModule: KotaModule = {
	name: "mcp-registry",
	version: "1.0.0",
	description: "Import external MCP server config from MCP Registry metadata",
	manifest: {
		schemaVersion: 1,
		capabilities: [
			{
				id: "mcp-registry.import",
				description: "Resolve MCP Registry metadata into strict KOTA mcpServers configuration.",
				scope: "external",
				scopePolicyHooks: ["external-effects"],
			},
			{
				id: "mcp-registry.private-tunnel",
				description:
					"Resolve configured private MCP tunnel profiles into an existing MCP connection projection.",
				scope: "external",
				scopePolicyHooks: ["external-effects", "setup"],
				setupRequirementIds: ["private-tunnel-config", "private-tunnel-runtime-key"],
			},
		],
		dataClasses: [
			{
				id: "mcp-registry.private-tunnel-credentials",
				description: "Runtime API key references for outbound private MCP tunnel clients.",
				sensitivity: "credential",
				retention: "scope-durable",
				redaction: "mask-secret",
			},
			{
				id: "mcp-registry.private-target-metadata",
				description: "Private MCP target labels, commands, URLs, and tunnel association metadata.",
				sensitivity: "internal",
				retention: "scope-durable",
				redaction: "metadata-only",
			},
		],
		simulation: {
			support: "external-effects-blocked",
			blockedReasons: [
				"Private MCP tunnel profiles can launch outbound tunnel clients and are blocked in workflow trial mode.",
			],
		},
	},
	setupRequirements: privateTunnelSetupRequirements,
	configSchema: privateTunnelConfigSchema,
	commands: (ctx) => [buildMcpRegistryCommand({
		getConfig: () => ctx.getModuleConfig<McpRegistryModuleConfig>(),
		getSecret: ctx.getSecret,
	})],
};

export default mcpRegistryModule;
