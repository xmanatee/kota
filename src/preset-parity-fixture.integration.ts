import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { resolveAgentHarness } from "#core/agent-harness/registry.js";
import type { KotaConfig } from "#core/config/config.js";
import { type ControlAddress, fetchAuthorized, pollControlFile, waitForExit } from "#core/daemon/built-cli-daemon-test-support.integration.js";
import type { Preset } from "#core/model/preset.js";
import { classifyThrownAgentError } from "#core/workflow/steps/step-executor-retry.js";
import { assertPresetParityModels, type ParityEvidence, type ParitySurface, parityEvidenceSchema } from "#modules/eval-harness/preset-parity-evidence.js";

const workflowRunsSchema = z.object({ runs: z.array(z.object({ id: z.string(), workflow: z.string(), status: z.string() })) });
const captureSchema = z.object({ ok: z.boolean(), target: z.string().optional(), id: z.string().optional() });
const recallSchema = z.object({ ok: z.boolean(), hits: z.array(z.object({ id: z.string() })).optional() });
const answerSchema = z.object({ ok: z.boolean(), citations: z.array(z.object({ id: z.string() })).optional() });
const storedProbeSchema = z.object({
  runId: z.string(),
  start: z.object({ output: z.object({ presetId: z.string() }) }),
  agent: z.object({ status: z.string(), model: z.string(), harness: z.string() }),
});

function requireOutcome(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The control listener opens before workflow startup. Its running flag is
 * liveness; the runtime's loaded observation establishes definition readiness.
 * Once loaded, a missing probe is a registration failure, not a reason to retry.
 */
export async function waitForPresetParityWorkflows(request: (path: string) => Promise<unknown>) {
  const deadline = Date.now() + 30_000;
  const statusSchema = z.object({ definitionsLoadedAt: z.iso.datetime().optional() });
  while (true) {
    const status = statusSchema.parse(await request("/workflow/status"));
    if (status.definitionsLoadedAt !== undefined) break;
    requireOutcome(Date.now() < deadline, "Timed out waiting for workflow definitions to load");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const { definitions } = z.object({ definitions: z.array(z.object({ name: z.string() })) })
    .parse(await request("/workflow/definitions"));
  for (const name of ["preset-parity-single-turn", "preset-parity-tool-turn", "preset-parity-workflow", "preset-parity-autonomy"]) {
    requireOutcome(definitions.some((definition) => definition.name === name), `Missing workflow ${name}`);
  }
  return definitions;
}

/** Operator setup for the API-backed capture/answer surfaces. Native login
 * authenticates the agent harness only; it does not configure ModelClient.
 * Keep model IDs entirely in the preset and store only secret references here.
 */
export function presetParityScopeConfig(preset: Preset, env: NodeJS.ProcessEnv = process.env): Partial<KotaConfig> {
  let modelProvider: NonNullable<KotaConfig["modelProvider"]>;
  switch (preset.id) {
    case "claude": modelProvider = { type: "anthropic" }; break;
    case "codex": modelProvider = { type: "openai" }; break;
    case "gemini": modelProvider = {
      type: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: `$${preset.authEnv.find((name) => Boolean(env[name])) ?? preset.authEnv[0]}`,
    }; break;
    default: throw new Error(`Preset parity does not configure provider ${preset.id}`);
  }
  return { autoEnable: ["code"], modelProvider };
}

/** The same built CLI and HTTP journey used by the explicit live test. */
export class PresetParityFixture {
  readonly scopeRoot = mkdtempSync(join(tmpdir(), "kota-preset-parity-"));
  readonly nonce = randomUUID();
  private child?: ChildProcess;
  private address?: ControlAddress;
  private readonly logs: string[] = [];
  private readonly transcript: string[] = [];
  private readonly failures: string[] = [];
  private readonly knownRejections: string[] = [];

  constructor(readonly preset: Preset, private readonly repoRoot: string, readonly artifactDir: string) {}

  private artifact(name: string, value: unknown): void {
    mkdirSync(this.artifactDir, { recursive: true });
    writeFileSync(join(this.artifactDir, name), `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    if (!this.address) throw new Error("Daemon address is unavailable");
    const response = await fetchAuthorized(this.address.port, path, this.address.token, {
      signal: AbortSignal.timeout(240_000),
      ...(body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    });
    const text = await response.text();
    this.transcript.push(`${body === undefined ? "GET" : "POST"} ${path} -> ${response.status}\n${text}`);
    this.artifact("transcript.txt", this.transcript.join("\n\n"));
    requireOutcome(response.ok, `${path}: HTTP ${response.status}: ${text}`);
    return JSON.parse(text);
  }

  async boot(): Promise<void> {
    const stateDir = join(this.scopeRoot, ".kota");
    const fixtureHome = join(this.scopeRoot, "home");
    const moduleDir = join(stateDir, "modules", "preset-parity-probe");
    mkdirSync(moduleDir, { recursive: true });
    mkdirSync(join(fixtureHome, ".kota"), { recursive: true });
    writeFileSync(join(fixtureHome, ".kota", "config.json"), JSON.stringify({ trustedScopes: [this.scopeRoot] }));
    writeFileSync(join(stateDir, "config.json"), JSON.stringify(presetParityScopeConfig(this.preset)));
    writeFileSync(join(moduleDir, "index.mjs"), `import { createPresetParityModule } from ${JSON.stringify(pathToFileURL(join(this.repoRoot, "dist/modules/eval-harness/preset-parity-module.js")).href)};\nexport default createPresetParityModule();\n`);
    writeFileSync(join(this.scopeRoot, "parity-input.txt"), this.nonce);
    writeFileSync(join(this.scopeRoot, "parity-single-turn.md"), "Reply with the single word OK and nothing else. Do not use tools.");
    const filePrompt = resolveAgentHarness(this.preset.harness).toolControl === "native"
      ? "Read parity-input.txt using your native file tools. Return its contents exactly."
      : "Use your file-read tool (Read or file_read) to read parity-input.txt. Return its contents exactly.";
    writeFileSync(join(this.scopeRoot, "parity-tool-turn.md"), filePrompt);
    writeFileSync(join(this.scopeRoot, "parity-workflow.md"), "Reply with the single word OK. Do not use tools.");
    writeFileSync(join(this.scopeRoot, "parity-autonomy.md"), "Complete the read-only fixture task in parity-task.md. Use the file-read tool, then report its requested result. No repository changes are needed.");
    writeFileSync(join(this.scopeRoot, "parity-task.md"), `# Read-only builder fixture\nRead parity-input.txt and return its contents exactly.\n`);
    // Preserve only an adapter-declared login locator across the isolated KOTA
    // home. No credential is read, copied, logged, or put into a prompt here.
    const authEnv = resolveAgentHarness(this.preset.harness).resolveIsolatedHostAuthEnv?.(process.env) ?? {};
    writeFileSync(join(this.scopeRoot, ".gitignore"), ".kota/\nhome/\nparity-*-run.json\n");
    for (const args of [["init"], ["config", "user.name", "Parity Fixture"], ["config", "user.email", "parity@example.invalid"], ["add", "."], ["commit", "-m", "Read-only parity fixture"]]) {
      execFileSync("git", args, { cwd: this.scopeRoot, stdio: "ignore" });
    }
    const args = [join(this.repoRoot, "dist/cli.js"), "daemon", "--preset", this.preset.id, "--scope-root", this.scopeRoot, "--log-format", "json", "--verbose"];
    this.artifact("invocation.json", { command: process.execPath, args, scopeRoot: this.scopeRoot });
    this.child = spawn(process.execPath, args, {
      cwd: this.scopeRoot,
      env: { ...process.env, ...authEnv, HOME: fixtureHome, KOTA_SCOPE_ROOT: this.scopeRoot,
        KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH: "", NODE_OPTIONS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.logs.push(chunk.toString()));
    this.child.stderr?.on("data", (chunk: Buffer) => this.logs.push(chunk.toString()));
    const exit = new Promise<number>((resolve, reject) => {
      this.child!.once("exit", (code) => resolve(code ?? -1));
      this.child!.once("error", reject);
    });
    try { this.address = await pollControlFile(stateDir, 30_000, exit); }
    catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}\n${this.logs.join("")}`); }
    const status = z.object({ running: z.boolean() }).parse(await this.request("/status"));
    requireOutcome(status.running, "Daemon did not report ready");
    const definitions = await waitForPresetParityWorkflows((path) => this.request(path));
    // Keep this disposable daemon's unrelated background fleet idle. Public
    // operator controls do not mutate the daemon that launched the test.
    for (const definition of definitions) {
      if (!definition.name.startsWith("preset-parity-")) await this.request(`/workflow/definitions/${encodeURIComponent(definition.name)}/disable`, {});
    }
    const evidence = await this.evidence();
    requireOutcome(evidence.presetId === this.preset.id, "Daemon ignored --preset");
  }

  private async evidence(): Promise<ParityEvidence> {
    const evidence = parityEvidenceSchema.parse(await this.request("/preset-parity/evidence"));
    this.artifact("adapter-calls.json", evidence);
    return evidence;
  }

  private async surface(name: ParitySurface, run: () => Promise<void>): Promise<void> {
    const attempts = name === "capture" || name === "answer" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const firstCall = (await this.evidence()).calls.length;
      try {
        await this.request("/preset-parity/surface", { surface: name });
        await run();
        this.transcript.push(`PASS ${name}`);
        return;
      } catch (error) {
        const message = `${name}: ${error instanceof Error ? error.message : String(error)}`;
        const observed = await this.evidence();
        const providerFailure = observed.calls.slice(firstCall).some((call) =>
          call.error && classifyThrownAgentError(new Error(call.error))?.retryable === true);
        if (attempt + 1 < attempts && providerFailure) {
          // Retry only the disposable model-dependent request. Retain all failed
          // calls and any fallback capture so the final sweep sees them too.
          this.transcript.push(`RETRY ${message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        this.failures.push(message);
        this.transcript.push(`FAIL ${message}`);
      } finally {
        await this.evidence();
      }
      return;
    }
  }

  private async workflow(surface: "single-turn" | "tool-turn" | "workflow" | "autonomy"): Promise<void> {
    const name = `preset-parity-${surface}`;
    await this.request("/workflow/trigger", { name });
    const deadline = Date.now() + 420_000;
    let run: z.infer<typeof workflowRunsSchema>["runs"][number] | undefined;
    while (Date.now() < deadline) {
      const result = workflowRunsSchema.parse(await this.request(`/workflow/runs?workflow=${name}`));
      run = result.runs.find((item) => item.workflow === name);
      if (run && !["running", "queued"].includes(run.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    requireOutcome(run?.status === "success", `${name} did not complete: ${run?.status ?? "no run"}`);
    this.artifact(`${surface}-run.json`, await this.request(`/workflow/runs/${run.id}`));
    const stored = storedProbeSchema.parse(JSON.parse(readFileSync(join(this.scopeRoot, `parity-${surface}-run.json`), "utf8")));
    this.artifact(`${surface}-steps.json`, stored);
    const expected = surface === "autonomy" ? this.preset.tiers.capable : this.preset.tiers.balanced;
    requireOutcome(stored.runId === run.id && stored.start.output.presetId === this.preset.id && stored.agent.status === "success" && stored.agent.model === expected && stored.agent.harness === this.preset.harness, `${name}: persisted runtime selection drifted`);
    const calls = (await this.evidence()).calls.filter((call) => call.runId === run.id && call.boundary === "harness");
    const expectedText = surface === "workflow" || surface === "single-turn" ? "OK" : this.nonce;
    requireOutcome(calls.some((call) => call.status === "success" && (call.turns ?? 0) >= 1 && call.text?.trim() === expectedText), `${name}: missing expected completed harness turn`);
    if (surface === "tool-turn") {
      const harness = resolveAgentHarness(this.preset.harness);
      const rejection = harness.unsupportedRunOptions?.find((option) => option.runOption === "canUseTool");
      if (harness.toolControl === "native" && rejection) {
        const message = `${harness.name}: ${rejection.reason}`;
        this.knownRejections.push(message);
        this.transcript.push(`KNOWN REJECTION tool-turn canUseTool: ${message}`);
        this.artifact("known-rejections.json", this.knownRejections);
      } else {
        requireOutcome(calls.some((call) => call.status === "success" && call.tools.some((tool) => tool === "Read" || tool === "file_read" || tool.endsWith("__file_read"))), "File read never crossed canUseTool");
      }
    }
  }

  async scenario(): Promise<void> {
    await this.surface("single-turn", () => this.workflow("single-turn"));
    await this.surface("tool-turn", () => this.workflow("tool-turn"));
    let capturedId: string | undefined;
    await this.surface("capture", async () => {
      const firstCall = (await this.evidence()).calls.length;
      const capture = captureSchema.parse(await this.request("/capture", { text: `Remember: my parity launch phrase is ${this.nonce}.` }));
      requireOutcome(capture.ok && capture.target === "memory" && capture.id, "Capture did not retain the classified memory note");
      capturedId = capture.id;
      const calls = (await this.evidence()).calls.filter((call) => call.id >= firstCall && call.surface === "capture" && call.boundary === "model-client");
      requireOutcome(calls.length > 0 && calls.every((call) => call.status === "success"), "Capture classifier failed or was bypassed");
    });
    await this.surface("recall", async () => {
      const recall = recallSchema.parse(await this.request("/recall", { query: this.nonce }));
      requireOutcome(capturedId && recall.ok && recall.hits?.some((hit) => hit.id === capturedId), "Recall cannot find the captured note");
    });
    await this.surface("answer", async () => {
      const firstCall = (await this.evidence()).calls.length;
      const answer = answerSchema.parse(await this.request("/answer", { query: `What is my parity launch phrase ${this.nonce}?` }));
      requireOutcome(capturedId && answer.ok && answer.citations?.some((citation) => citation.id === capturedId), "Answer did not cite the captured memory");
      const calls = (await this.evidence()).calls.filter((call) => call.id >= firstCall && call.surface === "answer" && call.boundary === "model-client");
      requireOutcome(calls.length > 0 && calls.every((call) => call.status === "success"), "Answer synthesis failed or was bypassed");
    });
    await this.surface("workflow", () => this.workflow("workflow"));
    await this.surface("autonomy", () => this.workflow("autonomy"));
    const evidence = await this.evidence();
    try { assertPresetParityModels(this.preset, evidence); } catch (error) {
      this.failures.push(error instanceof Error ? error.message : String(error));
    }
    this.artifact("result.json", { presetId: this.preset.id, failures: this.failures, knownRejections: this.knownRejections, passed: this.failures.length === 0 });
    requireOutcome(this.failures.length === 0, this.failures.join("\n"));
  }

  async close(): Promise<void> {
    try {
      if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill("SIGTERM");
        if (await waitForExit(this.child, 10_000) === null && this.child.signalCode === null) {
          this.child.kill("SIGKILL");
          await waitForExit(this.child, 2_000);
        }
      }
      this.artifact("daemon.log", this.logs.join(""));
      this.artifact("transcript.txt", this.transcript.join("\n\n"));
      this.artifact("cleanup.json", { exitCode: this.child?.exitCode, signal: this.child?.signalCode,
        controlFileRemoved: !existsSync(join(this.scopeRoot, ".kota/daemon-control.json")) });
    } finally { rmSync(this.scopeRoot, { recursive: true, force: true }); }
  }
}
