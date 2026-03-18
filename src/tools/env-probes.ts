import { execFile } from "node:child_process";
import {
	arch,
	cpus,
	freemem,
	hostname,
	version as osVersion,
	platform,
	totalmem,
	uptime,
	userInfo,
} from "node:os";

const EXEC_TIMEOUT = 3_000;

export function exec(
	cmd: string,
	args: string[],
	timeout = EXEC_TIMEOUT,
): Promise<string> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout, maxBuffer: 512 * 1024 }, (error, stdout) => {
			resolve(error ? "" : (stdout ?? "").trim());
		});
	});
}

function formatBytes(bytes: number): string {
	const gb = bytes / (1024 * 1024 * 1024);
	return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	parts.push(`${mins}m`);
	return parts.join(" ");
}

export async function queryOS(): Promise<string> {
	const lines: string[] = ["## OS"];
	const plat = platform();

	lines.push(`platform: ${plat}`);
	lines.push(`arch: ${arch()}`);

	if (plat === "darwin") {
		const ver = await exec("sw_vers", ["-productVersion"]);
		if (ver) lines.push(`version: macOS ${ver}`);
	} else if (plat === "linux") {
		const pretty = await exec("sh", [
			"-c",
			"grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\"'",
		]);
		if (pretty) lines.push(`version: ${pretty}`);
		else lines.push(`kernel: ${osVersion()}`);
	} else {
		lines.push(`version: ${osVersion()}`);
	}

	lines.push(`hostname: ${hostname()}`);

	try {
		lines.push(`user: ${userInfo().username}`);
	} catch {
		/* userInfo can throw on some platforms */
	}

	lines.push(`shell: ${process.env.SHELL ?? (plat === "win32" ? "cmd.exe" : "unknown")}`);
	lines.push(`uptime: ${formatUptime(uptime())}`);

	if (plat !== "win32") {
		const sudo = await exec("sh", ["-c", "command -v sudo"]);
		lines.push(`sudo: ${sudo ? "available" : "not available"}`);
	}

	return lines.join("\n");
}

type RuntimeCheck = { name: string; cmd: string; args: string[] };

const RUNTIME_CHECKS: RuntimeCheck[] = [
	{ name: "node", cmd: "node", args: ["--version"] },
	{ name: "python3", cmd: "python3", args: ["--version"] },
	{ name: "python", cmd: "python", args: ["--version"] },
	{ name: "go", cmd: "go", args: ["version"] },
	{ name: "rustc", cmd: "rustc", args: ["--version"] },
	{ name: "java", cmd: "java", args: ["-version"] },
	{ name: "ruby", cmd: "ruby", args: ["--version"] },
	{ name: "deno", cmd: "deno", args: ["--version"] },
	{ name: "bun", cmd: "bun", args: ["--version"] },
];

const PKG_MANAGER_CHECKS: RuntimeCheck[] = [
	{ name: "npm", cmd: "npm", args: ["--version"] },
	{ name: "pnpm", cmd: "pnpm", args: ["--version"] },
	{ name: "yarn", cmd: "yarn", args: ["--version"] },
	{ name: "pip", cmd: "pip3", args: ["--version"] },
	{ name: "cargo", cmd: "cargo", args: ["--version"] },
	{ name: "brew", cmd: "brew", args: ["--version"] },
];

const VERSION_PATTERNS: Record<string, RegExp> = {
	go: /go(\d+\.\d+[.\d]*)/,
	java: /version "([^"]+)"/,
	rustc: /rustc\s+([\d.]+)/,
	ruby: /ruby\s+([\d.]+)/,
	cargo: /cargo\s+([\d.]+)/,
	brew: /Homebrew\s+([\d.]+)/,
	pip: /pip\s+([\d.]+)/,
	deno: /deno\s+([\d.]+)/,
};

function extractVersion(name: string, raw: string): string {
	const pattern = VERSION_PATTERNS[name];
	if (pattern) {
		const source = name === "java" ? raw : raw.split("\n")[0].trim();
		const m = source.match(pattern);
		return m ? m[1] : raw.split("\n")[0].trim();
	}
	const m = raw.split("\n")[0].trim().match(/([\d]+\.[\d]+[.\d]*)/);
	return m ? m[1] : raw.split("\n")[0].trim();
}

async function detectChecks(checks: RuntimeCheck[]): Promise<{ name: string; version: string }[]> {
	const results = await Promise.all(
		checks.map(async ({ name, cmd, args }) => {
			const out = await exec(cmd, args);
			return out ? { name, version: extractVersion(name, out) } : null;
		}),
	);
	return results.filter(Boolean) as { name: string; version: string }[];
}

export async function queryRuntimes(): Promise<string> {
	const lines: string[] = ["## Runtimes"];

	const found = await detectChecks(RUNTIME_CHECKS);
	const hasPython3 = found.some((r) => r.name === "python3");
	const filtered = hasPython3 ? found.filter((r) => r.name !== "python") : found;

	if (filtered.length === 0) {
		lines.push("(no runtimes detected)");
	} else {
		for (const { name, version } of filtered) lines.push(`${name}: ${version}`);
	}

	lines.push("");
	lines.push("## Package Managers");

	const pkgFound = await detectChecks(PKG_MANAGER_CHECKS);
	if (pkgFound.length === 0) {
		lines.push("(none detected)");
	} else {
		for (const { name, version } of pkgFound) lines.push(`${name}: ${version}`);
	}

	return lines.join("\n");
}

function parsePorts(lsofOutput: string): string[] {
	const entries: string[] = [];
	const seen = new Set<string>();

	for (const line of lsofOutput.split("\n").slice(1)) {
		const parts = line.trim().split(/\s+/);
		if (parts.length < 9) continue;
		const [proc, pid] = parts;
		const addr = parts[8];
		const key = `${proc}:${addr}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const portMatch = addr.match(/:(\d+)$/);
		if (portMatch) entries.push(`${portMatch[1]} (${proc}, pid ${pid})`);
	}
	return entries;
}

export async function queryServices(): Promise<string> {
	const lines: string[] = ["## Services"];
	const plat = platform();

	let ports = "";
	if (plat === "darwin" || plat === "linux") {
		ports = await exec("sh", ["-c", "lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | tail -20"]);
	}

	if (ports) {
		const parsed = parsePorts(ports);
		if (parsed.length > 0) {
			lines.push(`Listening ports (${parsed.length}):`);
			for (const p of parsed) lines.push(`  ${p}`);
		} else {
			lines.push("ports: none listening");
		}
	} else {
		lines.push("ports: unable to detect");
	}

	const docker = await exec("docker", ["version", "--format", "{{.Server.Version}}"]);
	if (docker) {
		const containers = await exec("docker", [
			"ps", "--format", "{{.Names}}: {{.Image}} ({{.Status}})",
		]);
		const count = containers ? containers.split("\n").filter(Boolean).length : 0;
		lines.push(`docker: ${docker} (${count} running container${count !== 1 ? "s" : ""})`);
		if (containers && count <= 10) {
			for (const c of containers.split("\n").filter(Boolean)) lines.push(`  ${c}`);
		}
	} else {
		lines.push("docker: not available");
	}

	return lines.join("\n");
}

export async function queryResources(): Promise<string> {
	const lines: string[] = ["## Resources"];
	const plat = platform();

	const cpuInfo = cpus();
	if (cpuInfo.length > 0) {
		lines.push(`cpu: ${cpuInfo[0].model.trim()} (${cpuInfo.length} cores)`);
	}

	const total = totalmem();
	const free = freemem();
	lines.push(`memory: ${formatBytes(total - free)} used / ${formatBytes(total)} total (${formatBytes(free)} free)`);

	if (plat !== "win32") {
		const df = await exec("df", ["-h", "."]);
		if (df) {
			const dfLines = df.split("\n");
			if (dfLines.length >= 2) {
				const parts = dfLines[1].trim().split(/\s+/);
				if (parts.length >= 4) {
					lines.push(`disk (.): ${parts[2]} used / ${parts[1]} total (${parts[3]} free)`);
				}
			}
		}
	}

	const gpu = await exec("nvidia-smi", [
		"--query-gpu=name,memory.total,memory.free",
		"--format=csv,noheader,nounits",
	]);
	if (gpu) {
		for (const line of gpu.split("\n").filter(Boolean)) {
			const [name, memTotal, memFree] = line.split(",").map((s) => s.trim());
			lines.push(`gpu: ${name} (${memTotal}MB total, ${memFree}MB free)`);
		}
	} else if (plat === "darwin") {
		const sysctl = await exec("sysctl", ["-n", "machdep.cpu.brand_string"]);
		if (sysctl?.includes("Apple")) {
			lines.push("gpu: Apple integrated (use system_profiler for details)");
		}
	}

	return lines.join("\n");
}
