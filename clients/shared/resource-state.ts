export type ResourceState<T, E = string, U = string> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'retrying' }
  | { readonly status: 'refreshing'; readonly value: T }
  | { readonly status: 'success'; readonly value: T }
  | { readonly status: 'empty' }
  | { readonly status: 'offline'; readonly error: E }
  | { readonly status: 'cancelled' }
  | { readonly status: 'recoverable-failure'; readonly error: E }
  | { readonly status: 'failure'; readonly error: E }
  | { readonly status: 'semantic-unavailable'; readonly reason: U };

export type ResourceStart = 'load' | 'refresh' | 'retry';

export type ResourceFailure<E = string, U = string> =
  | { readonly status: 'offline'; readonly error: E }
  | { readonly status: 'cancelled' }
  | { readonly status: 'recoverable-failure'; readonly error: E }
  | { readonly status: 'failure'; readonly error: E }
  | { readonly status: 'semantic-unavailable'; readonly reason: U };

export function startResource<T, E, U>(
  current: ResourceState<T, E, U>,
  requested: ResourceStart = 'load',
): ResourceState<T, E, U> {
  if (
    requested === 'refresh' &&
    (current.status === 'success' || current.status === 'refreshing')
  ) {
    return { status: 'refreshing', value: current.value };
  }
  return { status: requested === 'retry' ? 'retrying' : 'loading' };
}

export function succeedResource<T, E = string, U = string>(
  value: T,
  isEmpty: (value: T) => boolean,
): ResourceState<T, E, U> {
  return isEmpty(value) ? { status: 'empty' } : { status: 'success', value };
}

export function resourceValue<T, E, U>(
  state: ResourceState<T, E, U>,
): T | undefined {
  return state.status === 'success' || state.status === 'refreshing'
    ? state.value
    : undefined;
}

export function resourceIsPending<T, E, U>(
  state: ResourceState<T, E, U>,
): boolean {
  return (
    state.status === 'loading' ||
    state.status === 'retrying' ||
    state.status === 'refreshing'
  );
}
