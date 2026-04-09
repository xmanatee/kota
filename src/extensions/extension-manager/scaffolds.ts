import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function generateExtensionScaffold(name: string, safeName: string, dir: string): void {
  const srcDir = join(dir, "src");
  mkdirSync(srcDir, { recursive: true });

  writeFileSync(join(dir, "package.json"), packageJson(safeName));
  writeFileSync(join(dir, "tsconfig.json"), tsconfig());
  writeFileSync(join(srcDir, "index.ts"), indexTs(name, safeName));
  writeFileSync(join(dir, "AGENTS.md"), agentsMd(name, safeName));
}

function packageJson(safeName: string): string {
  return `${JSON.stringify(
    {
      name: safeName,
      version: "0.1.0",
      description: "",
      type: "module",
      main: "dist/index.js",
      exports: { ".": "./dist/index.js" },
      scripts: {
        build: "tsc",
        typecheck: "tsc --noEmit",
      },
      peerDependencies: {
        kota: "*",
      },
      devDependencies: {
        kota: "*",
        typescript: "^5.7.0",
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        outDir: "dist",
        declaration: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`;
}

function indexTs(name: string, safeName: string): string {
  const toolName = `${safeName.replace(/-/g, "_")}_hello`;
  return `import type { KotaExtension, ToolDef } from "kota/extension";

// KotaExtension supports: tools, commands, routes, workflows, channels,
// skills, agents, onLoad, onUnload. Add fields as your extension grows.

const helloTool: ToolDef = {
  tool: {
    name: "${toolName}",
    description: "A stub tool — replace with real logic.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "Message to echo" },
      },
      required: ["message"],
    },
  },
  runner: async (input) => {
    const { message } = input as { message: string };
    return { content: \`${name}: \${message}\` };
  },
};

const extension: KotaExtension = {
  name: "${safeName}",
  version: "0.1.0",
  description: "${name} extension",
  tools: [helloTool],
  // onLoad: (ctx) => { /* initialize — ctx.log, ctx.storage, ctx.config */ },
  // onUnload: () => { /* clean up connections, timers */ },
};

export default extension;
`;
}

function agentsMd(name: string, safeName: string): string {
  return `# ${name} Extension

This directory contains the \`${name}\` KOTA extension.

## Purpose

<!-- Describe what this extension does and why it exists. -->

## Boundaries

- Contribute tools, commands, routes, workflows, channels, skills, or agents
  via the \`KotaExtension\` export in \`src/index.ts\`.
- Do not import KOTA internals directly; use the \`ExtensionContext\` API
  passed to \`onLoad\` for runtime services (storage, logging, config).

## Development

\`\`\`sh
pnpm install         # install devDependencies (including kota for types)
pnpm run typecheck   # verify types against KotaExtension
pnpm build           # compile to dist/
\`\`\`

For local drop-in use without npm, compile and copy \`dist/index.js\` to
\`.kota/extensions/${safeName}/index.js\` in your KOTA project.
`;
}

export function generatePythonScaffold(name: string, safeName: string, dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.py"), pythonMainPy(name, safeName));
  writeFileSync(join(dir, "requirements.txt"), "");
  writeFileSync(join(dir, "README.md"), pythonReadmeMd(name, safeName));
  writeFileSync(join(dir, ".kota-config-snippet.json"), pythonConfigSnippet(safeName));
}

function pythonMainPy(name: string, safeName: string): string {
  const toolName = `${safeName.replace(/-/g, "_")}_hello`;
  return `#!/usr/bin/env python3
"""${name} — KEMP subprocess extension for KOTA.

Communicates with KOTA over stdin/stdout using newline-delimited JSON (NDJSON).
Add your tools to the TOOLS dict and implement their logic in the handlers below.

Protocol reference: docs/FOREIGN-EXTENSIONS.md
"""
import json
import sys


def send(msg: dict) -> None:
    """Write a single KEMP message to stdout and flush immediately."""
    print(json.dumps(msg), flush=True)


def log(level: str, message: str) -> None:
    """Send a log message to KOTA (forwarded to KOTA's stderr)."""
    send({"type": "log", "level": level, "message": message})


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "${toolName}",
        "description": "A stub tool — replace with real logic.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Message to echo"},
            },
            "required": ["message"],
        },
    },
]


def handle_${toolName}(input_data: dict) -> str:
    """Return the echoed message."""
    return f"${name}: {input_data['message']}"


HANDLERS = {
    "${toolName}": handle_${toolName},
}


# ---------------------------------------------------------------------------
# Main message loop
# ---------------------------------------------------------------------------

def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            log("error", f"Invalid JSON: {exc}")
            continue

        msg_type = msg.get("type")
        msg_id = msg.get("id")

        if msg_type == "init":
            send({
                "id": msg_id,
                "type": "manifest",
                "name": "${safeName}",
                "version": "0.1.0",
                "description": "${name} extension",
                "tools": TOOLS,
            })

        elif msg_type == "invoke":
            tool_name = msg.get("name")
            handler = HANDLERS.get(tool_name)
            if handler is None:
                send({"id": msg_id, "type": "result", "content": f"Unknown tool: {tool_name}", "is_error": True})
            else:
                try:
                    result = handler(msg.get("input", {}))
                    send({"id": msg_id, "type": "result", "content": result})
                except Exception as exc:  # noqa: BLE001
                    send({"id": msg_id, "type": "result", "content": str(exc), "is_error": True})

        elif msg_type == "ping":
            send({"id": msg_id, "type": "pong"})

        elif msg_type == "shutdown":
            send({"id": msg_id, "type": "shutdown_ack"})
            break

        else:
            log("warn", f"Unhandled message type: {msg_type}")


if __name__ == "__main__":
    main()
`;
}

function pythonReadmeMd(name: string, safeName: string): string {
  return `# ${name}

A Python KEMP subprocess extension for [KOTA](https://github.com/anthropics/kota).

## Usage

Register this extension in your KOTA project's \`.kota/config.json\`:

\`\`\`json
{
  "foreignExtensions": [
    {
      "transport": "stdio",
      "command": "python3",
      "args": ["path/to/${safeName}/main.py"]
    }
  ]
}
\`\`\`

A ready-to-paste config fragment is in \`.kota-config-snippet.json\`.

## Smoke test

Pipe a handcrafted \`init\` message to verify the extension responds:

\`\`\`sh
echo '{"id":"1","type":"init","cwd":".","config":{}}' | python3 main.py
\`\`\`

Expected output (one line):

\`\`\`json
{"id": "1", "type": "manifest", "name": "${safeName}", "version": "0.1.0", ...}
\`\`\`

## Adding tools

1. Add a tool schema entry to the \`TOOLS\` list in \`main.py\`.
2. Add a handler function named \`handle_<tool_name>\`.
3. Register it in the \`HANDLERS\` dict.

## Protocol

Full protocol reference: \`docs/FOREIGN-EXTENSIONS.md\` in the KOTA repository.
`;
}

function pythonConfigSnippet(safeName: string): string {
  return `${JSON.stringify(
    {
      foreignExtensions: [
        {
          transport: "stdio",
          command: "python3",
          args: [`.kota/extensions/${safeName}/main.py`],
        },
      ],
    },
    null,
    2,
  )}\n`;
}
