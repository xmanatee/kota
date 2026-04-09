# KOTA Mobile

React Native (Expo) mobile client for the KOTA daemon. Monitor and control your autonomous development system from your phone.

## Features

- Live daemon status with active workflow runs
- Pending approval list — approve or reject from the app
- Run history with per-step breakdown
- Task queue overview by state
- SSE-driven live updates; polling fallback when SSE is unavailable

## Getting Started

```sh
cd clients/mobile
npm install
npm start          # Expo Go / dev build
```

## Configuration

On first launch, enter the daemon URL and auth token in **Settings** (gear icon on the Status tab). The token is stored in the OS secure keychain.

To find the token, read `.kota/daemon-control.json` from your project directory:

```sh
cat .kota/daemon-control.json
```

Enter the `port` as part of the URL (e.g. `http://192.168.1.10:49251`) and paste the `token` value.

## Requirements

- iOS 16+ or Android 12+ (API 31+)
- KOTA daemon running and reachable (local network or VPN)
