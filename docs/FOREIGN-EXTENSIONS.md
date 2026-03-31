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

#### `ping` (KOTA → Module)

Optional health check sent periodically by KOTA. The module should reply with
`pong` using the same `id`. If no `pong` is received within `pingTimeoutMs`
(default: 5 seconds), KOTA treats the subprocess as hung and triggers the
restart logic.

```json
{"id":"4","type":"ping"}
```

#### `pong` (Module → KOTA)

Response to `ping`. Echo the same `id`.

```json
{"id":"4","type":"pong"}
```

Modules that do not implement ping will silently time out and be restarted —
ping/pong is fully optional and backward compatible.

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

### stdio

KOTA spawns the module as a subprocess. Messages go:
- KOTA → Module: process stdin
- Module → KOTA: process stdout
- Module stderr: forwarded to KOTA stderr (debug only)

### http

KOTA connects to an already-running HTTP server. Each KEMP message is sent
as a JSON `POST` body; the server replies with the corresponding inbound
message as a JSON body.

```
POST /  (or any path — KOTA always posts to the configured url)
Content-Type: application/json

{"id":"1","type":"init","cwd":"/path/to/project"}
```

Response:
```
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"1","type":"manifest","name":"my-http-tools","version":"1.0.0","tools":[...]}
```

Use this transport to connect KOTA to an already-running service (a Python
FastAPI server, a Go binary, a remote tool host) without spawning a subprocess.
The server must handle concurrent requests if KOTA sends overlapping invocations.

A working Node.js example server lives at `examples/extensions/kota-demo-http.js`.

---

---

## Subprocess Recovery (stdio only)

KOTA automatically restarts crashed or hung stdio subprocesses. Recovery is
controlled by optional config fields on each stdio extension entry:

| Field | Default | Description |
|---|---|---|
| `maxRestarts` | `3` | Maximum restart attempts. Set `0` to disable. |
| `pingTimeoutMs` | `5000` | Milliseconds to wait for a `pong` before declaring the process hung. Set `0` to disable pings. |
| `pingIntervalMs` | `30000` | How often KOTA sends a health-check ping. Set `0` to disable. |
| `restartBackoffBaseMs` | `2000` | Base ms for exponential restart backoff. |

When a subprocess exits unexpectedly, KOTA:

1. Detects the exit via its internal receive loop.
2. Logs the event to stderr.
3. Attempts to respawn up to `maxRestarts` times with exponential backoff
   (`backoffBase × 2^(attempt-1)` ms).
4. Resets the restart counter after a successful restart.
5. Emits bus event `extension.failed` when all attempts are exhausted.

In-flight tool invocations during a restart return an error result immediately
(they do not hang).

---

## Configuration

Add `foreignExtensions` to your `.kota/config.json`:

**stdio transport:**

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
| `transport` | yes      | `"stdio"` |
| `command`   | yes      | Executable to run. |
| `args`      | no       | Arguments passed to the executable. |
| `env`       | no       | Additional environment variables. |
| `cwd`       | no       | Working directory (default: project root). |
| `maxRestarts` | no     | Max restart attempts on crash (default: 3, set 0 to disable). |
| `pingTimeoutMs` | no   | Ping response deadline in ms (default: 5000, set 0 to disable). |
| `pingIntervalMs` | no  | Health-check ping interval in ms (default: 30000, set 0 to disable). |

**http transport:**

```json
{
  "foreignExtensions": [
    {
      "transport": "http",
      "url": "http://localhost:8765",
      "bearerToken": { "env": "MY_EXT_SECRET" }
    }
  ]
}
```

| Field         | Required | Description |
|---------------|----------|-------------|
| `transport`   | yes      | `"http"` |
| `url`         | yes      | Base URL of the running KEMP HTTP server. |
| `bearerToken` | no       | Bearer token sent as `Authorization: Bearer <token>` on every request. Supply a string literal or `{ "env": "ENV_VAR_NAME" }` to read from an environment variable. Omit to send no Authorization header. |

Per-extension config can be passed in `config.extensions`, keyed by the
extension's `url` (for HTTP) or `command` path (for stdio):

```json
{
  "extensions": {
    "http://localhost:8765": {"api_key": "..."}
  }
}
```

KOTA looks up the config block by transport address before sending `init`, and
passes it as the `config` field in the `init` message.

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
- `src/foreign-extension-http.ts` — `HttpTransport` implementation.
- `src/foreign-extension-loader.ts` — handshake, wrapping as `KotaExtension`.

From the rest of KOTA's perspective, a foreign extension is a normal
`KotaExtension` — its tools are registered and invoked the same way as any
built-in or TypeScript extension.
