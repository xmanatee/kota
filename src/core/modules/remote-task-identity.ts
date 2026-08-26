import { createHash } from "node:crypto";

/** Stable numeric facade for providers whose remote ids are strings. */
export class RemoteTaskIdentity {
  private readonly remoteByLocal = new Map<number, string>();
  private readonly localByRemote = new Map<string, number>();

  constructor(private readonly provider: string) {}

  localId(remoteId: string): number {
    const existing = this.localByRemote.get(remoteId);
    if (existing !== undefined) return existing;
    const numericRemoteId = /^\d+$/.test(remoteId) ? Number(remoteId) : Number.NaN;
    const localId = Number.isSafeInteger(numericRemoteId) && numericRemoteId > 0
      ? numericRemoteId
      : this.hashedId(remoteId);
    const collision = this.remoteByLocal.get(localId);
    if (collision !== undefined && collision !== remoteId) {
      throw new Error(
        `${this.provider} task identities ${JSON.stringify(collision)} and ${JSON.stringify(remoteId)} collide at ${localId}`,
      );
    }
    this.remoteByLocal.set(localId, remoteId);
    this.localByRemote.set(remoteId, localId);
    return localId;
  }

  remoteId(localId: number): string | undefined {
    return this.remoteByLocal.get(localId);
  }

  private hashedId(remoteId: string): number {
    const digest = createHash("sha256")
      .update(this.provider)
      .update("\0")
      .update(remoteId)
      .digest();
    return digest.readUIntBE(0, 6) || 1;
  }
}
