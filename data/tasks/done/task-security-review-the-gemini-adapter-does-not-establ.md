---
id: task-security-review-the-gemini-adapter-does-not-establ
title: Security review: The Gemini adapter does not establish the claimed provider/tool credential boundary. It copies OAuth credentials beneath the invocation root and projects Gemini API keys into the native process environment, while KOTA makes the invocation root readable. On the installed Gemini CLI 0.46.0 macOS path, `--sandbox` uses a permissive profile and treats read-only shell commands such as `cat` as safe; shell execution also inherits the environment when redaction is disabled. Untrusted prompt content can therefore read cached OAuth material or API keys and return them through model-visible tool output or workflow artifacts.
status: done
priority: p1
area: security
task_class: Safety
summary: The Gemini adapter does not establish the claimed provider/tool credential boundary. It copies OAuth credentials beneath the invocation root and projects Gemini API keys into the native process environment, while KOTA makes the invocation root readable. On the installed Gemini CLI 0.46.0 macOS path, `--sandbox` uses a permissive profile and treats read-only shell commands such as `cat` as safe; shell execution also inherits the environment when redaction is disabled. Untrusted prompt content can therefore read cached OAuth material or API keys and return them through model-visible tool output or workflow artifacts.
created_at: 2026-08-05T17:08:46.522Z
updated_at: 2026-08-06T03:30:23.459Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/gemini-cli-agent-harness/cli-runner.ts
claim:

> The Gemini adapter does not establish the claimed provider/tool credential boundary. It copies OAuth credentials beneath the invocation root and projects Gemini API keys into the native process environment, while KOTA makes the invocation root readable. On the installed Gemini CLI 0.46.0 macOS path, `--sandbox` uses a permissive profile and treats read-only shell commands such as `cat` as safe; shell execution also inherits the environment when redaction is disabled. Untrusted prompt content can therefore read cached OAuth material or API keys and return them through model-visible tool output or workflow artifacts.

## Desired Outcome

> Move Gemini authentication behind a provider-only process or authenticated host broker so native tools never share its files or environment. Until that boundary exists, reject credential-bearing Gemini native launches. Add a live regression using the supported stable Gemini CLI that proves authentication succeeds while read-only shell and environment probes cannot access GEMINI_CLI_HOME OAuth files, GEMINI_API_KEY, or GOOGLE_API_KEY.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Completion

The overlapping Gemini workspace-configuration fix in commit `fac9281cc`
removed copied OAuth state and made credential-bearing native launches fail
before Gemini or repository-controlled configuration can start. Authenticated
native runs remain unavailable until provider authentication is brokered
outside Gemini's native tool process tree. Focused runtime-home coverage now
pins the same fail-closed result for `GEMINI_API_KEY` and `GOOGLE_API_KEY` as
well as cached OAuth files.

Verification:

- `pnpm test src/modules/gemini-cli-agent-harness/runtime-home.test.ts src/modules/gemini-cli-agent-harness/adapter.test.ts src/modules/gemini-cli-agent-harness/auth-readiness.test.ts`
- `pnpm typecheck`
- `pnpm validate-tasks`

The focused suite passed 26 tests. Typecheck and task validation also passed.
A broader `pnpm test src/modules/gemini-cli-agent-harness` run passed 27 tests;
its one integration case could not bind the native egress proxy because this
builder sandbox rejects `listen(127.0.0.1)` with `EPERM`.

## Source / Intent

Created by security-review workflow run 2026-08-05T14-47-33-581Z-security-review-1v638s.

finding id: gemini-native-tools-can-read-provider-credentials
candidate id: auth-approval-boundary:src/modules/gemini-cli-agent-harness/cli-runner.ts:218
verdict: confirmed
rationale:

> KOTA copies OAuth files beneath the recursively readable invocation root and passes GEMINI_API_KEY and GOOGLE_API_KEY into the Gemini process. Gemini CLI 0.46.0 uses a macOS sandbox profile that allows reads by default, while shell subprocess environment redaction defaults to disabled. The stock headless policy does deny shell execution, so the investigation's known-safe `cat` evidence alone is incomplete. However, KOTA also passes `--skip-trust`, loads workspace settings, and Gemini converts `settings.tools.allowed` into higher-priority allow rules that override the default headless denial. Once enabled through this supported trusted-workspace configuration, native shell tools share both the credential-bearing environment and readable provider home. The claimed provider/tool credential boundary therefore does not exist.

Evidence:

Evidence 1:



path: src/modules/gemini-cli-agent-harness/runtime-home.ts

line: 68

excerpt:



> const runtimeHome = join(context.invocationRoot, "gemini-provider-home");
> const runtimeDirectory = join(runtimeHome, ".gemini");
> ...
> for (const filename of ["oauth_creds.json", "google_accounts.json"]) {
>   copyPrivateFile(...);
> }
> ...
> return { ...env, [GEMINI_CLI_HOME_ENV]: runtimeHome };

Evidence 2:



path: src/modules/gemini-cli-agent-harness/cli-runner.ts

line: 33

excerpt:



> const GEMINI_CLI_AUTH_ENV_KEYS = [
>   GEMINI_CLI_HOME_ENV,
>   "GEMINI_API_KEY",
>   "GOOGLE_API_KEY",
> ] as const;

Evidence 3:



path: src/core/agent-harness/native-cli-sandbox-roots.ts

line: 144

excerpt:



> return [...new Set([
>   ...platformRoots.filter(existsSync),
>   cwd,
>   invocationRoot,
>   ...nativeCliGitMetadataRoots(cwd),

Evidence 4:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 211

excerpt:



> buildMachineAuthoritySandboxLaunch(launchExecutable, launchArgs, {
>   cwd: options.cwd,
>   authorityConfigPath: options.authorityConfigPath,
>   readableRoots,
>   writableRoots: [...options.writableRoots, temporaryDirectory],
>   readProtectedPaths,

Evidence 5:



path: src/modules/gemini-cli-agent-harness/cli-runner.ts

line: 209

excerpt:



> const cliArgs = [
>   "--sandbox",
>   "--skip-trust",
>   "--prompt",
>   args.prompt,
>   ...
>   "--approval-mode",
>   args.approvalMode,
> ];

Evidence 6:



path: /opt/homebrew/Cellar/gemini-cli/0.46.0/libexec/lib/node_modules/@google/gemini-cli/bundle/sandbox-macos-permissive-open.sb

line: 3

excerpt:



> ;; allow everything by default
> (allow default)
>
> ;; deny all writes EXCEPT under specific paths
> (deny file-write*)

Evidence 7:



path: /opt/homebrew/Cellar/gemini-cli/0.46.0/libexec/lib/node_modules/@google/gemini-cli/bundle/chunk-RCJSF5RP.js

line: 251658

excerpt:



> const safeCommands = /* @__PURE__ */ new Set([
>   "__read",
>   "__write",
>   "cat",
>   "cd",
>   "cut",
>   "echo",

Evidence 8:



path: /opt/homebrew/Cellar/gemini-cli/0.46.0/libexec/lib/node_modules/@google/gemini-cli/bundle/chunk-RCJSF5RP.js

line: 252005

excerpt:



> function sanitizeEnvironment(processEnv, config2) {
>   const isStrictSanitization = !!processEnv["GITHUB_SHA"] || processEnv["SURFACE"] === "Github";
>   if (!config2.enableEnvironmentVariableRedaction && !isStrictSanitization) {
>     return { ...processEnv };
>   }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
