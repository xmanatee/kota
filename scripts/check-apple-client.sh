#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

destination="${KOTA_IOS_TEST_DESTINATION:-}"
if [ -z "$destination" ]; then
  simulator_id="$(xcrun simctl list devices available -j | node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const devices = Object.values(JSON.parse(readFileSync(0, "utf8")).devices)
      .flat().filter(device => device.isAvailable && device.name.startsWith("iPhone"));
    const device = devices.find(device => device.state === "Booted") ?? devices[0];
    if (!device) throw new Error("Install an iPhone simulator in Xcode before running check:apple.");
    console.log(device.udid);
  ')"
  destination="platform=iOS Simulator,id=$simulator_id"
fi

pnpm check:ui-bindings
cd clients/apple
swift build
swift test
xcodebuild build -scheme KotaiOS -destination 'generic/platform=iOS Simulator' -derivedDataPath .build/ios
xcodebuild test -scheme KotaApple-Package -destination "$destination" -derivedDataPath .build/ios
