// Approval queue items as exposed by `GET /approvals` and the
// approve/reject control routes.

import { daemonRequest, type DaemonHttp } from './http';

export interface Approval {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  review:
	    | {
	        status: 'available';
	        input: Record<string, unknown>;
	        context?: string;
	        digest: string;
	      }
    | { status: 'unavailable'; reason: 'input_unavailable' };
  risk: string;
  reason?: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  timeoutMs?: number;
}

export function getApprovals(
  http: DaemonHttp,
): Promise<{ approvals: Approval[] }> {
  return daemonRequest<{ approvals: Approval[] }>(http, '/approvals');
}

export function approveApproval(
  http: DaemonHttp,
  id: string,
  reviewDigest: string,
  note?: string,
): Promise<{ approval: Approval }> {
  return daemonRequest<{ approval: Approval }>(
    http,
    `/approvals/${encodeURIComponent(id)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewDigest, note }),
    },
  );
}

export function rejectApproval(
  http: DaemonHttp,
  id: string,
  reason?: string,
): Promise<{ approval: Approval }> {
  return daemonRequest<{ approval: Approval }>(
    http,
    `/approvals/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
    },
  );
}
