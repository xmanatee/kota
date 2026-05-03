#!/usr/bin/env bash
# Build the KotaiOS executable for the iOS Simulator. SwiftPM cannot
# emit a runnable iOS .app bundle on its own (MenuBarExtra equivalents
# need a real Info.plist with UIApplication wiring), so we route
# through `xcodebuild` against the package-generated scheme.
set -euo pipefail

cd "$(dirname "$0")"

DESTINATION="${DESTINATION:-generic/platform=iOS Simulator}"
DERIVED="${DERIVED:-.build/ios}"

xcodebuild build \
    -scheme KotaiOS \
    -destination "${DESTINATION}" \
    -derivedDataPath "${DERIVED}" \
    | tail -20

ARTIFACT="${DERIVED}/Build/Products/Debug-iphonesimulator/KotaiOS"
if [[ -e "${ARTIFACT}" ]]; then
    echo "Built KotaiOS at ${ARTIFACT}"
fi
