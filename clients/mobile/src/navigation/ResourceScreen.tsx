import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import type { ResourceState } from '../../../shared/resource-state';
import { CenteredMessage } from './CenteredMessage';
import { navigationStyles as styles } from './styles';

type ResourceScreenCopy = {
  readonly loading: string;
  readonly failure: string;
  readonly retryAccessibilityLabel: string;
  readonly empty: string;
  readonly emptyDetail?: string;
  readonly idle: string;
  readonly cancelled: string;
  readonly semanticUnavailable: string;
};

export function ResourceScreen<T>({
  resource,
  copy,
  onRetry,
  failureActions,
  children,
}: {
  resource: ResourceState<T>;
  copy: ResourceScreenCopy;
  onRetry: () => void;
  failureActions?: React.ReactNode;
  children: (value: T, refreshing: boolean) => React.ReactNode;
}) {
  switch (resource.status) {
    case 'loading':
    case 'retrying':
      return <CenteredMessage loading title={copy.loading} />;
    case 'refreshing':
      return children(resource.value, true);
    case 'success':
      return children(resource.value, false);
    case 'empty':
      return <CenteredMessage title={copy.empty} detail={copy.emptyDetail} />;
    case 'offline':
    case 'recoverable-failure':
      return (
        <CenteredMessage
          title={copy.failure}
          detail={resource.error}
          detailAccessibilityRole="alert"
        >
          <TouchableOpacity
            style={styles.primaryButton}
            accessibilityRole="button"
            accessibilityLabel={copy.retryAccessibilityLabel}
            onPress={onRetry}
          >
            <Text style={styles.primaryButtonLabel}>Retry</Text>
          </TouchableOpacity>
          {failureActions}
        </CenteredMessage>
      );
    case 'failure':
      return (
        <CenteredMessage
          title={copy.failure}
          detail={resource.error}
          detailAccessibilityRole="alert"
        >
          {failureActions}
        </CenteredMessage>
      );
    case 'cancelled':
      return <CenteredMessage title={copy.cancelled} />;
    case 'semantic-unavailable':
      return (
        <CenteredMessage
          title={copy.semanticUnavailable}
          detail={resource.reason}
        />
      );
    case 'idle':
      return <CenteredMessage title={copy.idle} />;
    default:
      return assertNever(resource);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled resource state: ${JSON.stringify(value)}`);
}
