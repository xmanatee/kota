import { afterEach, describe, expect, it } from "vitest";
import { confirmAction, confirmExecution, isDangerous, setSkipConfirmations } from "./confirm.js";

afterEach(() => {
  setSkipConfirmations(false);
});

describe("isDangerous", () => {
  const dangerous = [
    "rm -rf /tmp/foo",
    "rm file.txt",
    "git push origin main",
    "git push --force",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git checkout .",
    "docker rm container-id",
    "sudo apt-get install foo",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda",
    "kill -9 1234",
    "chmod 777 /etc/passwd",
    "npm publish",
    "pnpm publish",
    "yarn publish",
    "echo data > /dev/sda",
  ];

  for (const cmd of dangerous) {
    it(`detects "${cmd}" as dangerous`, () => {
      expect(isDangerous(cmd)).toBe(true);
    });
  }

  const safe = [
    "ls -la",
    "cat file.txt",
    "git status",
    "git log --oneline",
    "git diff",
    "git add .",
    "git commit -m 'fix'",
    "npm install",
    "npm test",
    "npm run build",
    "node index.js",
    "echo hello",
    "grep -r pattern .",
    "docker ps",
    "docker build .",
    "chmod 644 file.txt",
    "mkdir -p /tmp/test",
  ];

  for (const cmd of safe) {
    it(`allows "${cmd}" as safe`, () => {
      expect(isDangerous(cmd)).toBe(false);
    });
  }
});

describe("confirmExecution", () => {
  it("returns true when skip is enabled", async () => {
    setSkipConfirmations(true);
    const result = await confirmExecution("rm -rf /");
    expect(result).toBe(true);
  });

  it("returns false when stdin is not a TTY", async () => {
    setSkipConfirmations(false);
    // In test environment, stdin is not a TTY
    const result = await confirmExecution("rm -rf /");
    expect(result).toBe(false);
  });
});

describe("confirmAction", () => {
  it("returns true when skip is enabled", async () => {
    setSkipConfirmations(true);
    const result = await confirmAction("Delete everything?");
    expect(result).toBe(true);
  });

  it("returns false when stdin is not a TTY", async () => {
    setSkipConfirmations(false);
    // In test environment, stdin is not a TTY
    const result = await confirmAction("Delete everything?");
    expect(result).toBe(false);
  });
});
