import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";

/**
 * Serializes a short canonical mutation against workflow admission for the
 * same logical resource. The workflow run store remains the only resource
 * authority; callers do not create leases or ownership records of their own.
 */
export type LogicalResourceAuthority = {
  withResourceAvailable<T>(input: {
    projectId: string;
    resourceKey: string;
    operation: () => T;
  }): T;
};

export const LOGICAL_RESOURCE_AUTHORITY_PROVIDER_TYPE: ProviderToken<LogicalResourceAuthority> =
  defineProviderToken<LogicalResourceAuthority>("workflow-logical-resource-authority");
