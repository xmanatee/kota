import type { ToolDef } from "#core/modules/module-types.js";
import { networkDestructiveEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { LinearFetchFn } from "./task-provider.js";

type LinearGraphQLError = { message: string };

function gqlError(action: string, errors: LinearGraphQLError[]): ToolResult {
  return {
    content: `Linear API error (${action}): ${errors.map((e) => e.message).join(", ")}`,
    is_error: true,
  };
}

export type LinearTeamContext = {
  teamId: string;
  stateIds: Map<string, string>;
};

export async function resolveTeamContext(
  fetch: LinearFetchFn,
  teamKey: string,
): Promise<LinearTeamContext> {
  const teamRes = await fetch(
    `query GetTeam($key: String!) {
      teams(filter: { key: { eq: $key } }) {
        nodes {
          id
          states { nodes { id name type } }
        }
      }
    }`,
    { key: teamKey },
  );
  if (teamRes.errors?.length) {
    throw new Error(
      `Linear: failed to get team — ${teamRes.errors.map((e) => e.message).join(", ")}`,
    );
  }

  type TeamNode = { id: string; states: { nodes: Array<{ id: string; name: string; type: string }> } };
  const teams = (teamRes.data.teams as { nodes: TeamNode[] }).nodes;
  if (!teams.length) {
    throw new Error(`Linear: team "${teamKey}" not found`);
  }

  const stateIds = new Map<string, string>();
  for (const state of teams[0].states.nodes) {
    stateIds.set(state.name, state.id);
  }

  return { teamId: teams[0].id, stateIds };
}

export function makeLinearTools(
  fetch: LinearFetchFn,
  getTeamContext: () => Promise<LinearTeamContext>,
): ToolDef[] {
  return [
    makeCreateIssue(fetch, getTeamContext),
    makeUpdateIssueState(fetch, getTeamContext),
    makeAddComment(fetch),
  ];
}

function makeCreateIssue(
  fetch: LinearFetchFn,
  getTeamContext: () => Promise<LinearTeamContext>,
): ToolDef {
  return {
    effect: networkDestructiveEffect(),
    tool: {
      name: "linear_create_issue",
      description:
        "Create a new Linear issue in the configured team. Returns the issue identifier and URL.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Issue title" },
          description: { type: "string", description: "Issue description (Markdown)" },
          priority: {
            type: "number",
            enum: [0, 1, 2, 3, 4],
            description: "Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low",
          },
          labelName: { type: "string", description: "Label name to apply to the issue" },
        },
        required: ["title"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const title = input.title as string;
      if (!title) return { content: "Error: title is required", is_error: true };

      const { teamId } = await getTeamContext();

      let labelIds: string[] | undefined;
      if (input.labelName) {
        const labelRes = await fetch(
          `query FindLabel($teamId: String!, $labelName: String!) {
            team(id: $teamId) {
              labels(filter: { name: { eq: $labelName } }) {
                nodes { id }
              }
            }
          }`,
          { teamId, labelName: input.labelName },
        );
        if (labelRes.errors?.length) return gqlError("find label", labelRes.errors);
        const team = labelRes.data.team as { labels?: { nodes: Array<{ id: string }> } } | null;
        const nodes = team?.labels?.nodes ?? [];
        if (nodes.length > 0) labelIds = nodes.map((n) => n.id);
      }

      const vars: Record<string, unknown> = { teamId, title };
      if (input.description) vars.description = input.description;
      if (input.priority !== undefined) vars.priority = input.priority;
      if (labelIds?.length) vars.labelIds = labelIds;

      const res = await fetch(
        `mutation CreateIssue($teamId: String!, $title: String!, $description: String, $priority: Int, $labelIds: [String!]) {
          issueCreate(input: { teamId: $teamId, title: $title, description: $description, priority: $priority, labelIds: $labelIds }) {
            success
            issue { id identifier url }
          }
        }`,
        vars,
      );
      if (res.errors?.length) return gqlError("create issue", res.errors);

      const result = res.data.issueCreate as {
        success: boolean;
        issue?: { id: string; identifier: string; url: string };
      };
      if (!result.success || !result.issue) {
        return { content: "Linear issue creation failed.", is_error: true };
      }

      return {
        content: `Created ${result.issue.identifier}\n${result.issue.url}`,
      };
    },
  };
}

function makeUpdateIssueState(
  fetch: LinearFetchFn,
  getTeamContext: () => Promise<LinearTeamContext>,
): ToolDef {
  return {
    effect: networkDestructiveEffect(),
    tool: {
      name: "linear_update_issue_state",
      description:
        "Transition a Linear issue to a named workflow state (e.g. 'In Progress', 'Done').",
      input_schema: {
        type: "object" as const,
        properties: {
          issueId: { type: "string", description: "Linear issue UUID" },
          stateName: {
            type: "string",
            description: "Target workflow state name (must match a state in the team)",
          },
        },
        required: ["issueId", "stateName"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const issueId = input.issueId as string;
      const stateName = input.stateName as string;
      if (!issueId) return { content: "Error: issueId is required", is_error: true };
      if (!stateName) return { content: "Error: stateName is required", is_error: true };

      const { stateIds } = await getTeamContext();
      const stateId = stateIds.get(stateName);
      if (!stateId) {
        const available = [...stateIds.keys()].join(", ");
        return {
          content: `Error: unknown state "${stateName}". Available states: ${available}`,
          is_error: true,
        };
      }

      const res = await fetch(
        `mutation UpdateIssueState($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
            issue { id identifier state { name } }
          }
        }`,
        { id: issueId, stateId },
      );
      if (res.errors?.length) return gqlError("update issue state", res.errors);

      const result = res.data.issueUpdate as {
        success: boolean;
        issue?: { id: string; identifier: string; state: { name: string } };
      };
      if (!result.success || !result.issue) {
        return { content: "Linear issue state update failed.", is_error: true };
      }

      return {
        content: `${result.issue.identifier} → ${result.issue.state.name}`,
      };
    },
  };
}

function makeAddComment(fetch: LinearFetchFn): ToolDef {
  return {
    effect: networkDestructiveEffect(),
    tool: {
      name: "linear_add_comment",
      description: "Post a comment on an existing Linear issue.",
      input_schema: {
        type: "object" as const,
        properties: {
          issueId: { type: "string", description: "Linear issue UUID" },
          body: { type: "string", description: "Comment text (Markdown)" },
        },
        required: ["issueId", "body"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const issueId = input.issueId as string;
      const body = input.body as string;
      if (!issueId) return { content: "Error: issueId is required", is_error: true };
      if (!body) return { content: "Error: body is required", is_error: true };

      const res = await fetch(
        `mutation AddComment($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
            comment { id url }
          }
        }`,
        { issueId, body },
      );
      if (res.errors?.length) return gqlError("add comment", res.errors);

      const result = res.data.commentCreate as {
        success: boolean;
        comment?: { id: string; url: string };
      };
      if (!result.success || !result.comment) {
        return { content: "Linear comment creation failed.", is_error: true };
      }

      return { content: `Comment posted\n${result.comment.url}` };
    },
  };
}
