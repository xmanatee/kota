import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import type { DaemonControlAddress } from "#core/daemon/daemon-control-types.js";
import { readOptionalJsonFile } from "#root/json-file.js";

const require = createRequire(import.meta.url);

function getLocalNetworkIp(): string | null {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

function generateQr(text: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qrcodeTerminal = require("qrcode-terminal") as any;
  return new Promise((resolve) => {
    qrcodeTerminal.generate(text, { small: true }, (qr: string) => resolve(qr));
  });
}

export function buildQrCommand(): Command {
  return new Command("qr")
    .description("Print a QR code encoding the daemon URL and auth token for mobile client setup")
    .action(async () => {
      const stateDir = join(process.cwd(), ".kota");
      const address = readOptionalJsonFile<DaemonControlAddress>(
        join(stateDir, "daemon-control.json"),
      );

      if (!address || typeof address.port !== "number") {
        console.error("Daemon is not running. Start the daemon first with: kota daemon");
        process.exitCode = 1;
        return;
      }

      const ip = getLocalNetworkIp();
      if (!ip) {
        console.error("Could not detect local network IP address.");
        process.exitCode = 1;
        return;
      }

      const url = `http://${ip}:${address.port}`;
      const token = typeof address.token === "string" ? address.token : "";
      const payload = JSON.stringify({ url, token });

      const qr = await generateQr(payload);
      console.log("\nScan this QR code with the KOTA mobile app to configure the connection:\n");
      console.log(qr);
      console.log(`  URL:   ${url}`);
      console.log(`  Token: ${token ? `${token.slice(0, 8)}...` : "(none)"}\n`);
    });
}
