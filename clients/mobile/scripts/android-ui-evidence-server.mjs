import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const bundlePath = resolve(args.bundle);
const bundleBytes = await readFile(bundlePath);
const bundle = JSON.parse(bundleBytes.toString('utf8'));
assertBundle(bundle);
const digest = createHash('sha256').update(bundleBytes).digest('hex');

if (args.check) {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      bundlePath,
      sha256: digest,
      surfaces: bundle.surfaces.length,
    })}\n`,
  );
  process.exit(0);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname === '/health') {
    return json(response, 200, { ok: true });
  }
  if (request.headers.authorization !== `Bearer ${args.token}`) {
    return json(response, 401, { error: 'Unauthorized' });
  }

  if (url.pathname === '/events') {
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
    response.write(': android evidence stream\n\n');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/identity') {
    return json(response, 200, identity(bundle));
  }
  if (request.method === 'GET' && url.pathname === '/ui/surfaces') {
    return json(response, 200, bundle);
  }
  if (request.method === 'POST' && url.pathname === '/ui/actions/execute') {
    return json(response, 200, {
      ok: true,
      message: 'Android evidence action completed.',
    });
  }
  if (request.method === 'GET' && url.pathname === '/status') {
    return json(response, 200, { online: true, paused: false });
  }
  if (request.method === 'GET' && url.pathname === '/workflow/runs') {
    return json(response, 200, { runs: [] });
  }
  if (request.method === 'GET' && url.pathname === '/approvals') {
    return json(response, 200, { approvals: [] });
  }
  if (request.method === 'GET' && url.pathname === '/tasks') {
    return json(response, 200, { counts: {}, tasks: {} });
  }
  if (request.method === 'GET' && url.pathname === '/owner-questions') {
    return json(response, 200, { questions: [] });
  }
  return json(response, 404, { error: 'Not found', path: url.pathname });
});

server.listen(args.port, '127.0.0.1', () => {
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      url: `http://127.0.0.1:${args.port}`,
      bundlePath,
      sha256: digest,
      surfaces: bundle.surfaces.length,
    })}\n`,
  );
});

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--check') {
      values.set('check', true);
      continue;
    }
    if (!argument?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument ?? '<missing>'}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} needs a value.`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }
  const bundle = values.get('bundle');
  if (typeof bundle !== 'string') throw new Error('--bundle is required.');
  const token = values.get('token') ?? 'kota-android-evidence';
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('--token must not be empty.');
  }
  const portRaw = values.get('port') ?? '8765';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('--port must be an integer from 1024 through 65535.');
  }
  return { bundle, token, port, check: values.get('check') === true };
}

function assertBundle(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.protocolVersion !== 'ui.surface.v1' ||
    !Array.isArray(value.surfaces) ||
    value.surfaces.length === 0 ||
    typeof value.surfaces[0]?.scopeId !== 'string' ||
    value.surfaces[0].scopeId.length === 0
  ) {
    throw new Error('Bundle must be a non-empty ui.surface.v1 document.');
  }
}

function identity(value) {
  const scopeId = value.surfaces[0].scopeId;
  return {
    projectName: 'android-ui-evidence',
    projectDir: '/android-ui-evidence',
    projects: {
      defaultProjectId: scopeId,
      projects: [
        {
          projectId: scopeId,
          projectDir: '/android-ui-evidence',
          displayName: 'Android UI evidence',
        },
      ],
    },
    daemonVersion: 'evidence-fixture',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    dashboard: { available: false },
  };
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(`${JSON.stringify(value)}\n`);
}
