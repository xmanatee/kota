# Modular Architecture — Product Requirements

## Goal

KOTA's features (telegram, web UI, memory, scheduler, daemon, etc.) are hardcoded into the core. They should be **modules** — self-contained units that plug into a small core runtime. This turns KOTA from "an agent with built-in features" into "an agent runtime that loads modules."

## What a Module Can Do

A module is a unit of functionality that can:
- Register tools (plugins already do this)
- Register CLI commands (e.g., `telegram` adds the `kota telegram` command)
- Register HTTP routes (e.g., web module adds `/api/chat`, serves the UI)
- Subscribe to events on the event bus
- Register transports (new frontends)
- Declare configuration it needs
- Depend on other modules

The existing plugin system already covers "register tools." The module system extends that to cover everything else a feature needs.

## What the Core Provides to Modules

Modules need access to:
- Event bus (subscribe/emit)
- Scheduler (create/query scheduled items)
- Session creation (spin up agent sessions)
- Route registration (add HTTP endpoints)
- Command registration (add CLI subcommands)
- Config (read module-specific configuration)
- Logging

This is the core's API surface. Modules interact with the core only through this.

## What Becomes a Module

| Current built-in | As module | What it registers |
|-----------------|-----------|-------------------|
| `telegram.ts` | telegram | CLI command, transport |
| `server.ts` + `web-ui*.ts` + `session-pool.ts` | web | CLI command, HTTP routes, transport |
| `memory.ts` | memory | Tools |
| `scheduler.ts` + `action-executor.ts` | scheduler | Tools, event subscriptions |
| `daemon.ts` | daemon | CLI command, event subscriptions |
| `registry.ts` + `tool-adapters.ts` | registry | Tools |
| `vercel-ai-stream.ts` | vercel-adapter | HTTP middleware |

## What Stays in the Core

- Agent session loop (`loop.ts`, `context.ts`)
- Transport abstraction (types + base implementations)
- Event bus
- Tool execution engine
- Fundamental tools (file, shell, grep, glob — the tools the agent needs to function)
- CLI framework (parses argv, loads modules, dispatches to registered commands)
- Config loading
- Module loader (discovery + lifecycle)
- System prompt assembly
- MCP protocol support

## What This Enables (examples, not requirements)

Once the module protocol exists, external modules become possible:
- GitHub webhook handler
- Slack/email notifications
- Cron expressions
- Workflow definitions
- Module marketplace
- Metrics/observability
- Auth/OAuth

## Requirements

1. A module that registers a CLI command should make that command appear in `kota --help`
2. A module that registers HTTP routes should have those routes available when the server runs
3. A module that subscribes to events should receive them
4. Disabling a module in config should cleanly remove all its functionality
5. A third party should be able to write a module that adds a CLI command + HTTP endpoint + event handler + tools — using the same mechanism as built-in modules
6. Built-in modules ship with KOTA but use the same protocol as external ones
7. The core without any modules loaded should still function as a basic agent (run a prompt, get a response)

## Module Isolation

Modules must be independent and self-contained:
- Modules interact with the core and with each other **only through established APIs/protocols** — no reaching into internals, no shared mutable state, no direct imports of another module's files
- It should be possible to restart or upgrade a single module without stopping the KOTA process
- A module can use core functionality (sessions, event bus, config) and other modules' functionality, but only through the defined API surface
- Module failures must not crash the core or other modules

## Cleanup

The current codebase has redundancies, duplication, and abstractions that no longer make sense after the module extraction. These should be cleaned up:
- Remove dead code and unused abstractions left behind by module extractions
- Consolidate duplicated logic
- Remove or simplify abstractions that were only needed for the old monolithic structure
- The result should be a clean core + clean modules with no confusion about what lives where
