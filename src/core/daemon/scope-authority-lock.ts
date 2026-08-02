import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

type BoundaryValue = unknown;

type AuthorityTicket = {
  number: number;
  path: string;
  releasePath: string;
};

type AuthorityTicketOwner = {
  pid: number;
  token: string;
};

const AUTHORITY_LOCK_WAIT_MS = 10_000;
const AUTHORITY_LOCK_POLL_MS = 10;
const TICKET_PATTERN = /^ticket-(\d+)$/;
const RELEASE_PATTERN = /^released-(\d+)$/;

/**
 * Serialize machine-authority commits across daemon and CLI processes.
 *
 * Ticket files are an append-only lock ledger. A contender publishes a
 * fully-written owner record with an atomic hard link into the next numeric
 * slot, then waits for every lower slot to be released or owned by a dead
 * process. Slots are never reused, so a participant cannot appear behind an
 * owner that has already entered the critical section.
 */
export async function withAuthorityCommitLock<T>(
  configPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const ticket = acquireAuthorityCommitTicket(configPath);
  try {
    await waitForAuthorityCommitTurn(configPath, ticket);
    return await operation();
  } finally {
    releaseAuthorityCommitTicket(ticket);
  }
}

function acquireAuthorityCommitTicket(configPath: string): AuthorityTicket {
  const lockRoot = prepareLockRoot(configPath);
  const token = randomUUID();
  const candidatePath = join(
    dirname(lockRoot),
    `.${basename(configPath)}.scope-authority-candidate-${token}`,
  );
  writeFileSync(
    candidatePath,
    `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

  try {
    let number = nextTicketNumber(lockRoot);
    for (;;) {
      if (number >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Scope authority lock ticket space is exhausted");
      }
      const path = join(lockRoot, ticketName(number));
      try {
        linkSync(candidatePath, path);
        try {
          assertTicketPrefixComplete(lockRoot, number);
        } catch (error) {
          releaseAuthorityCommitTicket({
            number,
            path,
            releasePath: join(lockRoot, releaseName(number)),
          });
          throw error;
        }
        return {
          number,
          path,
          releasePath: join(lockRoot, releaseName(number)),
        };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        number += 1;
      }
    }
  } finally {
    removeCandidate(candidatePath);
  }
}

async function waitForAuthorityCommitTurn(
  configPath: string,
  ticket: AuthorityTicket,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (!existsSync(ticket.path)) {
      throw new Error(`${configPath}: scope authority write lock ownership was lost`);
    }
    let blocked = false;
    for (let number = 1; number < ticket.number; number += 1) {
      if (existsSync(join(dirname(ticket.path), releaseName(number)))) continue;
      const owner = readTicketOwner(join(dirname(ticket.path), ticketName(number)));
      if (isProcessAlive(owner.pid)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return;
    if (Date.now() - startedAt >= AUTHORITY_LOCK_WAIT_MS) {
      throw new Error(`${configPath}: timed out waiting for the scope authority write lock`);
    }
    await delay(AUTHORITY_LOCK_POLL_MS);
  }
}

function releaseAuthorityCommitTicket(ticket: AuthorityTicket): void {
  const owner = readTicketOwner(ticket.path);
  writeFileSync(
    ticket.releasePath,
    `${JSON.stringify({ token: owner.token, releasedAt: new Date().toISOString() })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

function prepareLockRoot(configPath: string): string {
  const parent = dirname(configPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lockRoot = join(parent, `.${basename(configPath)}.scope-authority.lock`);
  try {
    mkdirSync(lockRoot, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const stats = lstatSync(lockRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${lockRoot}: scope authority write lock must be a directory`);
  }
  return lockRoot;
}

function nextTicketNumber(lockRoot: string): number {
  let maximum = 0;
  for (const name of readdirSync(lockRoot)) {
    const ticket = TICKET_PATTERN.exec(name);
    if (ticket !== null) {
      maximum = Math.max(maximum, parseTicketNumber(lockRoot, name, ticket[1]));
      continue;
    }
    const release = RELEASE_PATTERN.exec(name);
    if (release !== null) {
      const number = parseTicketNumber(lockRoot, name, release[1]);
      if (!existsSync(join(lockRoot, ticketName(number)))) {
        throw new Error(`${join(lockRoot, name)}: release has no matching lock ticket`);
      }
      continue;
    }
    throw new Error(`${join(lockRoot, name)}: unexpected scope authority lock entry`);
  }
  if (maximum >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Scope authority lock ticket space is exhausted");
  }
  return maximum + 1;
}

function assertTicketPrefixComplete(lockRoot: string, number: number): void {
  for (let earlier = 1; earlier < number; earlier += 1) {
    if (!existsSync(join(lockRoot, ticketName(earlier)))) {
      throw new Error(
        `${lockRoot}: scope authority lock ledger is missing ticket ${earlier}`,
      );
    }
  }
}

function readTicketOwner(path: string): AuthorityTicketOwner {
  let raw: BoundaryValue;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: invalid scope authority lock owner: ${message}`);
  }
  if (
    typeof raw !== "object"
    || raw === null
    || !("pid" in raw)
    || typeof raw.pid !== "number"
    || !Number.isSafeInteger(raw.pid)
    || raw.pid <= 0
    || !("token" in raw)
    || typeof raw.token !== "string"
    || raw.token.length === 0
  ) {
    throw new Error(`${path}: invalid scope authority lock owner`);
  }
  return { pid: raw.pid, token: raw.token };
}

function parseTicketNumber(
  lockRoot: string,
  name: string,
  value: string,
): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${join(lockRoot, name)}: invalid scope authority lock ticket`);
  }
  return number;
}

function ticketName(number: number): string {
  return `ticket-${number}`;
}

function releaseName(number: number): string {
  return `released-${number}`;
}

function removeCandidate(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function errorCode(error: BoundaryValue): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
