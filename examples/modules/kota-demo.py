#!/usr/bin/env python3
"""
KOTA External Module Protocol demo — Python edition.

This script implements the KEMP stdio transport:
  1. Reads the `init` message from stdin.
  2. Responds with a `manifest` declaring two tools.
  3. Handles `invoke` messages and writes `result` responses.
  4. Exits cleanly on `shutdown`.

Usage in .kota/config.json:
{
  "foreignModules": [
    {
      "transport": "stdio",
      "command": "python3",
      "args": ["examples/modules/kota-demo.py"]
    }
  ]
}
"""

import json
import sys
import os
import datetime

MANIFEST = {
    "name": "kota-demo-python",
    "version": "1.0.0",
    "description": "Demo Python module for KOTA — provides two simple tools.",
    "tools": [
        {
            "name": "python_greet",
            "description": "Returns a greeting message from the Python module.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name to greet."
                    }
                },
                "required": ["name"]
            }
        },
        {
            "name": "python_env_info",
            "description": "Returns Python version and selected environment info.",
            "input_schema": {
                "type": "object",
                "properties": {}
            }
        }
    ]
}


def send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def log(level: str, message: str) -> None:
    sys.stdout.write(json.dumps({"type": "log", "level": level, "message": message}) + "\n")
    sys.stdout.flush()


def handle_invoke(msg: dict) -> dict:
    name = msg.get("name")
    inp = msg.get("input", {})

    if name == "python_greet":
        greeting_name = inp.get("name", "World")
        return {"id": msg["id"], "type": "result", "content": f"Hello, {greeting_name}! (from Python {sys.version.split()[0]})"}

    if name == "python_env_info":
        info = {
            "python_version": sys.version,
            "platform": sys.platform,
            "cwd": os.getcwd(),
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        }
        content = "\n".join(f"{k}: {v}" for k, v in info.items())
        return {"id": msg["id"], "type": "result", "content": content}

    return {
        "id": msg["id"],
        "type": "result",
        "content": f"Unknown tool: {name}",
        "is_error": True,
    }


def main():
    log("info", "Python demo module starting")

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            log("error", f"Failed to parse message: {e}")
            continue

        msg_type = msg.get("type")

        if msg_type == "init":
            log("info", f"Received init (cwd={msg.get('cwd', '?')})")
            send({"id": msg["id"], "type": "manifest", **MANIFEST})

        elif msg_type == "invoke":
            result = handle_invoke(msg)
            send(result)

        elif msg_type == "shutdown":
            log("info", "Shutting down")
            send({"id": msg["id"], "type": "shutdown_ack"})
            break

        else:
            log("warn", f"Unknown message type: {msg_type}")


if __name__ == "__main__":
    main()
