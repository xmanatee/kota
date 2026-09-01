import { useCallback, useEffect, useState } from 'react';
import {
  startResource,
  succeedResource,
  type ResourceFailure,
  type ResourceState,
} from '../../../shared/resource-state';

export function useResourceRequest<T, E = string, U = string>(
  request: () => Promise<T>,
  isEmpty: (value: T) => boolean,
  classifyFailure: (error: unknown) => ResourceFailure<E, U>,
): {
  resource: ResourceState<T, E, U>;
  retry: () => void;
} {
  const [retryRevision, setRetryRevision] = useState(0);
  const [resource, setResource] = useState<ResourceState<T, E, U>>({
    status: 'loading',
  });

  useEffect(() => {
    let active = true;
    setResource((current) =>
      startResource(
        current,
        current.status === 'offline' ||
          current.status === 'recoverable-failure'
          ? 'retry'
          : 'load',
      ),
    );
    void request().then(
      (value) => {
        if (active) setResource(succeedResource(value, isEmpty));
      },
      (error: unknown) => {
        if (active) setResource(classifyFailure(error));
      },
    );
    return () => {
      active = false;
    };
  }, [classifyFailure, isEmpty, request, retryRevision]);

  const retry = useCallback(() => {
    setRetryRevision((current) => current + 1);
  }, []);

  return { resource, retry };
}
