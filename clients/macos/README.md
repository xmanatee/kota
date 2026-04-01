# KOTA Menu Bar

A native macOS menu bar app (macOS 13+) that connects to the KOTA daemon control API.

## Features

- **Status icon** — green (idle), amber (runs active), red (error), slash (offline)
- **Active workflow runs** — name and elapsed time
- **Pending approvals** — one-click approve/reject buttons wired to `POST /approvals/:id/approve` and `POST /approvals/:id/reject`
- **Trigger workflow** — small dialog that calls `POST /workflow/trigger`
- **Open Dashboard** — opens `http://localhost:3000` (configurable) in the default browser
- **Settings** — configure project directory and web UI port

## Requirements

- macOS 13 (Ventura) or later
- Swift 5.9+ / Xcode 15+
- A running KOTA daemon (`kota daemon`)

## Build

```sh
cd clients/macos
swift build
```

The compiled binary is at `.build/debug/KotaMenuBar`.

## Run

```sh
.build/debug/KotaMenuBar
```

On first launch, click **Set Project Directory…** and select the folder that contains your `.kota/` directory (e.g. `~/Desktop/mono/apps/kota`).

## Daemon Discovery

The app reads `.kota/daemon-control.json` from the configured project directory to discover the daemon's port and authentication token. All API requests include `Authorization: Bearer <token>`. If the control file is absent or the daemon is unreachable, the icon shows a slash and all data is cleared.

## Architecture

All daemon communication goes through `DaemonClient`, which is a thin wrapper over `URLSession`. `AppState` polls every 5 seconds and drives all views via `@Published` properties. No daemon or server changes are required.
