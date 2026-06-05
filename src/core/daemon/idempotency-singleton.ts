import { join } from "node:path";
import { IdempotencyStore } from "./idempotency-store.js";

let store: IdempotencyStore | null = null;

export function getIdempotencyStore(
  dir?: string,
  scopeId = "default",
): IdempotencyStore {
  if (!store) {
    store = new IdempotencyStore(dir ?? join(process.cwd(), ".kota", "idempotency"), scopeId);
  }
  return store;
}

export function setIdempotencyStoreInstance(instance: IdempotencyStore): void {
  store = instance;
}

export function resetIdempotencyStore(): void {
  store = null;
}
