// Image-local setup verification. Uses the production native permission owner;
// no provider login, model invocation or host container launcher is involved.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathIsWithinRoots } from '#core/agent-harness/machine-authority-sandbox-paths.js';
import { withNativeCliSandbox } from '#core/agent-harness/native-cli-sandbox.js';
import { prepareCodexRuntimeEnvironment } from '#modules/codex-agent-harness/runtime-home.js';

const checkGrantsOnly = process.argv[2] === '--check-grants';
if (process.argv.length > (checkGrantsOnly ? 3 : 2)) throw new Error('Usage: verify-native-toolchain.mjs [--check-grants]');
if (process.platform !== 'linux') throw new Error('Run this check inside the Linux evaluation image.');
const root = mkdtempSync(join(tmpdir(), 'kota-toolchain-check-'));
const workspace = join(root, 'workspace');
const source = fileURLToPath(new URL('../../src/modules/eval-harness/fixtures/builder-algorithmic-resource-budget-canary/initial', import.meta.url));
try {
  cpSync(source, workspace, { recursive: true });
  await withNativeCliSandbox('codex', ['sandbox', 'linux', '--', '/bin/sh', '-ec', 'pnpm --version; pnpm test'], {
    cwd: workspace, machineAuthorityOwner: 'native-cli', writableRoots: [workspace],
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: root, CODEX_HOME: join(root, 'no-login'), COREPACK_HOME: join(root, 'empty-corepack'), COREPACK_ENABLE_NETWORK: '0' },
    prepareEnvironment(context, env) {
      for (const command of ['pnpm', 'codex']) {
        const target = realpathSync(`/usr/local/bin/${command}`);
        if (!pathIsWithinRoots(target, context.readableRoots) || pathIsWithinRoots(target, [...context.readProtectedPaths, ...context.readProtectedRoots])) {
          throw new Error(`${command} resolves outside the native tool read grants: ${target}`);
        }
        console.log(`Native tool grant covers ${command}: ${target}`);
      }
      return prepareCodexRuntimeEnvironment(context, env);
    },
  }, async (process) => {
    if (checkGrantsOnly) {
      console.log('Permission generation passed; sandbox execution was not requested.');
      return;
    }
    const result = spawnSync(process.command, process.args, { cwd: workspace, env: process.env, stdio: 'inherit', timeout: 60_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Native toolchain sandbox check failed: ${result.status ?? result.signal}`);
    console.log('Native sandbox pnpm test passed with the generated permissions; no model inference performed.');
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
