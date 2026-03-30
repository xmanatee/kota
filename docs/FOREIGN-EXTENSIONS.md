# Foreign-Language Extensions

KOTA supports extensions implemented outside the in-process TypeScript runtime.
A foreign extension is a subprocess (any language) that communicates with KOTA
over a simple JSON message protocol.

## Protocol Overview

The KOTA External Module Protocol (KEMP) is a newline-delimited JSON (NDJSON)
request/response protocol. KOTA and the module exchange single-line JSON objects
over a transport stream. The same message format applies regardless of transport.

### Message flow

```
KOTA                           Module
  │─── init ─────────────────────►│
  │◄── manifest ──────────────────│
  │─── invoke (tool A) ──────────►│
  │◄── result ────────────────────│
  │─── invoke (tool B) ──────────►│
  │◄── result ────────────────────│
  │─── shutdown ─────────────────►│
  │◄── shutdown_ack ──────────────│
```

All messages have a `type` field. Request/response pairs share a correlation
`id` field so KOTA can match responses to their requests.

Modules may emit `log` messages at any time (no `id` required).

### Message reference

#### `init` (KOTA → Module)

Sent once after the transport connects.

```json
{"id":"1","type":"init","cwd":"/path/to/project","config":{}}
```

| Field    | Type   | Description |
|----------|--------|-------------|
| `id`     | string | Correlation id — echo it in the manifest response. |
| `type`   | string | `"init"` |
| `cwd`    | string | KOTA project working directory. |
| `config` | object | Optional per-extension config from KOTA's config file. |

#### `manifest` (Module → KOTA)

Sent in response to `init`. Declares the module's identity and tools.

```json
{
  "id": "1",
  "type": "manifest",
  "name": "my-python-tools",
  "version": "1.0.0",
  "description": "Tools from Python",
  "tools": [
    {
      "name": "greet",
      "description": "Greet someone by name.",
      "input_schema": {
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"]
      }
    }
  ]
}
```

Tool schemas follow the Anthropic tool `input_schema` format (JSON Schema draft
2020-12, `type: object`).

#### `invoke` (KOTA → Module)

Sent when the agent calls a tool declared in the manifest.

```json
{"id":"2","type":"invoke","name":"greet","input":{"name":"World"}}
```

#### `result` (Module → KOTA)

Response to `invoke`.

```json
{"id":"2","type":"result","content":"Hello, World!","is_error":false}
```

| Field      | Type    | Description |
|------------|---------|-------------|
| `id`       | string  | Must match the `invoke` id. |
| `content`  | string  | Human-readable result text. |
| `is_error` | boolean | Optional. `true` if the tool call failed. |

#### `shutdown` (KOTA → Module)

Sent when KOTA is stopping or reloading the extension.

```json
{"id":"3","type":"shutdown"}
```

#### `shutdown_ack` (Module → KOTA)

Optional acknowledgement. Module should exit after sending this.

```json
{"id":"3","type":"shutdown_ack"}
```

#### `error` (Module → KOTA)

Sent when the module encounters a protocol or runtime error.

```json
{"id":"2","type":"error","message":"Tool 'greet' failed: ..."}
```

#### `log` (Module → KOTA)

Informational message forwarded to KOTA's stderr. No `id` needed.

```json
{"type":"log","level":"info","message":"Extension ready"}
```

Levels: `"debug"`, `"info"`, `"warn"`, `"error"`.

---

## Transports

### stdio (current)

KOTA spawns the module as a subprocess. Messages go:
- KOTA → Module: process stdin
- Module → KOTA: process stdout
- Module stderr: forwarded to KOTA stderr (debug only)

### Future transports

The protocol is transport-agnostic. Future transports may include Unix domain
sockets and HTTP long-poll, using the same NDJSON message format.

---

## Configuration

Add `foreignExtensions` to your `.kota/config.json`:

```json
{
  "foreignExtensions": [
    {
      "transport": "stdio",
      "command": "python3",
      "args": ["path/to/my_extension.py"],
      "env": {"MY_API_KEY": "..."},
      "cwd": "."
    }
  ]
}
```

| Field       | Required | Description |
|-------------|----------|-------------|
| `transport` | yes      | Transport kind. Currently `"stdio"` only. |
| `command`   | yes      | Executable to run. |
| `args`      | no       | Arguments passed to the executable. |
| `env`       | no       | Additional environment variables. |
| `cwd`       | no       | Working directory (default: project root). |

Per-extension config can be passed under the extension's declared name in
`config.extensions`:

```json
{
  "extensions": {
    "my-python-tools": {"api_key": "..."}
  }
}
```

KOTA looks up the extension's declared `name` from the manifest to find this
config block and passes it as `config` in the `init` message.

---

## Writing an Extension

Minimal Python example:

```python
#!/usr/bin/env python3
import json, sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg["type"] == "init":
        print(json.dumps({
            "id": msg["id"], "type": "manifest",
            "name": "my-tools", "version": "1.0",
            "tools": [{"name": "hello", "description": "Say hello.",
                        "input_schema": {"type": "object", "properties": {}}}]
        }), flush=True)
    elif msg["type"] == "invoke":
        print(json.dumps({"id": msg["id"], "type": "result",
                           "content": "Hello from Python!"}), flush=True)
    elif msg["type"] == "shutdown":
        print(json.dumps({"id": msg["id"], "type": "shutdown_ack"}), flush=True)
        break
```

Rules:
- Flush stdout after every message (buffering will cause hangs).
- Echo the `id` from the triggering message in every response.
- Exit after receiving `shutdown`.
- Log to stderr or via `log` messages — never to stdout outside of protocol messages.

A full working example lives at `examples/extensions/kota-demo.py`.

---

## Implementation

The TypeScript side of the protocol is in:

- `src/foreign-extension.ts` — KEMP message types and `ForeignExtensionConfig`.
- `src/foreign-extension-stdio.ts` — `StdioTransport` implementation.
- `src/foreign-extension-loader.ts` — handshake, wrapping as `KotaExtension`.

From the rest of KOTA's perspective, a foreign extension is a normal
`KotaExtension` — its tools are registered and invoked the same way as any
built-in or TypeScript extension.
