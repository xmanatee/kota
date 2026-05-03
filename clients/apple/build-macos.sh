#!/usr/bin/env bash
# Build a runnable KotaMenuBar.app from the SwiftPM target.
# MenuBarExtra requires a real .app bundle with LSUIElement=true; `swift run`
# alone produces a console binary that macOS won't promote to a GUI agent.
set -euo pipefail

cd "$(dirname "$0")"

CONFIG="${CONFIG:-release}"
APP_NAME="KotaMenuBar"
BUNDLE_ID="one.xmanatee.kota.menubar"
APP_DIR="${APP_NAME}.app"
CONTENTS="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS}/MacOS"

pkill -f "${APP_DIR}/Contents/MacOS/${APP_NAME}" 2>/dev/null || true

# Build only the macOS target. The shared package also contributes a
# `KotaiOS` executable target whose sources are wrapped in
# `#if os(iOS)`; building it here would link a no-op stub binary.
swift build -c "${CONFIG}" --product "${APP_NAME}"
BIN_PATH="$(swift build -c "${CONFIG}" --show-bin-path)"

rm -rf "${APP_DIR}"
mkdir -p "${MACOS_DIR}"
cp "${BIN_PATH}/${APP_NAME}" "${MACOS_DIR}/${APP_NAME}"

cat > "${CONTENTS}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>KOTA</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>KOTA records audio to transcribe voice messages via the daemon.</string>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "${APP_DIR}" >/dev/null

ABS_PATH="$(pwd)/${APP_DIR}"
echo "Built ${ABS_PATH}"
echo "Run with: open '${ABS_PATH}'"
