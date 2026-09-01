import type { ResourceState } from "../../../shared/resource-state";

type QueryResourceSnapshot<T> = {
  readonly data: T | undefined;
  readonly error: Error | null;
  readonly isFetching: boolean;
  readonly isPending: boolean;
};

export function queryResourceState<T>(
  snapshot: QueryResourceSnapshot<T>,
  isEmpty: (value: T) => boolean,
  online: boolean,
): ResourceState<T, Error> {
  if (snapshot.data !== undefined) {
    if (isEmpty(snapshot.data)) return { status: "empty" };
    if (snapshot.isFetching) {
      return { status: "refreshing", value: snapshot.data };
    }
    return { status: "success", value: snapshot.data };
  }
  if (!online) {
    return {
      status: "offline",
      error: snapshot.error ?? new Error("Daemon is offline."),
    };
  }
  if (snapshot.error && snapshot.isFetching) return { status: "retrying" };
  if (snapshot.isPending) return { status: "loading" };
  if (snapshot.error) {
    return { status: "recoverable-failure", error: snapshot.error };
  }
  return { status: "idle" };
}
