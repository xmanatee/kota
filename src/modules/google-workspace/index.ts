/**
 * Google Workspace module — Gmail, Calendar, and Drive tools for agents.
 *
 * Config (under modules.google-workspace):
 *   clientId:     OAuth 2.0 client ID or $SECRET_NAME reference. Required.
 *   clientSecret: OAuth 2.0 client secret or $SECRET_NAME reference. Required.
 *   refreshToken: OAuth 2.0 refresh token or $SECRET_NAME reference. Required.
 *   userId:       Gmail/Calendar user (default: "me")
 *   calendarId:   Calendar ID (default: "primary")
 *   inbound:      Optional account identity and trust lists for inbound routes.
 *
 * Auth setup:
 *   1. Create an OAuth 2.0 client in Google Cloud Console (Desktop app type).
 *   2. Enable Gmail API, Google Calendar API, and Google Drive API.
 *   3. Run the OAuth consent flow to get a refresh token with scopes:
 *      https://www.googleapis.com/auth/gmail.modify
 *      https://www.googleapis.com/auth/calendar
 *      https://www.googleapis.com/auth/drive.readonly
 *   4. Store credentials in .kota/config.json under modules.google-workspace,
 *      or use $SECRET_NAME references resolved by the shared secret provider.
 */

import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type {
  KotaModule,
  ModuleContext,
  ModuleRouteHandler,
  RouteRegistration,
  ToolDef,
} from "#core/modules/module-types.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import {
  type InboundSignalJsonObject,
  inboundSignalReceived,
} from "#modules/inbound-signals/events.js";
import { getAccessToken, resolveSecretReference } from "./auth.js";
import { makeCalendarCreateEvent, makeCalendarListEvents } from "./calendar.js";
import {
  createGoogleWorkspaceReadinessSource,
  GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
} from "./capability-readiness.js";
import { makeDriveListFiles, makeDriveReadFile } from "./drive.js";
import { makeGmailGetMessage, makeGmailListMessages, makeGmailSend } from "./gmail.js";
import {
  calendarEventChangeToInboundSignal,
  emitGoogleWorkspaceInboundSignal,
  type GoogleWorkspaceInboundSignalContext,
  type GoogleWorkspaceInboundTrustConfig,
  gmailMessageToInboundSignal,
  googleWorkspaceCalendarEventChangeFromInboundRequest,
  googleWorkspaceGmailMessageFromInboundRequest,
} from "./inbound-signal.js";

type GoogleWorkspaceInboundConfig = GoogleWorkspaceInboundTrustConfig & {
  /** Stable Google account identity for inbound signal source ids. */
  accountId?: string;
};

type GoogleWorkspaceConfig = {
  /** OAuth 2.0 client ID or $SECRET_NAME reference. Required. */
  clientId: string;
  /** OAuth 2.0 client secret or $SECRET_NAME reference. Required. */
  clientSecret: string;
  /** OAuth 2.0 refresh token or $SECRET_NAME reference. Required. */
  refreshToken: string;
  /** Gmail user ID (default: "me") */
  userId?: string;
  /** Calendar ID (default: "primary") */
  calendarId?: string;
  /** Optional sender/organizer trust lists for inbound Gmail and Calendar signals. */
  inbound?: GoogleWorkspaceInboundConfig;
};

const googleWorkspaceSetupRequirements: ModuleSetupRequirement[] = [
  {
    id: "oauth-config",
    kind: "config",
    title: "Google Workspace OAuth config references",
    description:
      "Non-sensitive config paths that point runtime OAuth fields at secret names.",
    required: true,
    scope: "project",
    owner: "google-workspace",
    sensitivity: "none",
    setup: {
      mode: "form",
      fields: [
        {
          id: "client-id-ref",
          label: "Client ID reference",
          type: "string",
          valueKind: "secret-reference",
          configPath: "modules.google-workspace.clientId",
          required: true,
          placeholder: "$GOOGLE_CLIENT_ID",
          helperText: "Use an environment or secret reference, not the raw client id.",
        },
        {
          id: "client-secret-ref",
          label: "Client secret reference",
          type: "string",
          valueKind: "secret-reference",
          configPath: "modules.google-workspace.clientSecret",
          required: true,
          placeholder: "$GOOGLE_CLIENT_SECRET",
          helperText: "Use an environment or secret reference, not the raw secret.",
        },
        {
          id: "refresh-token-ref",
          label: "Refresh token reference",
          type: "string",
          valueKind: "secret-reference",
          configPath: "modules.google-workspace.refreshToken",
          required: true,
          placeholder: "$GOOGLE_REFRESH_TOKEN",
          helperText: "Use an environment or secret reference, not the raw refresh token.",
        },
      ],
    },
  },
  {
    id: "oauth-credentials",
    kind: "oauth",
    title: "Google Workspace OAuth credentials",
    description:
      "OAuth client and refresh token values stored through the shared secret provider.",
    required: true,
    scope: "project",
    owner: "google-workspace",
    health: { capabilityIds: [GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID] },
    sensitivity: "oauth",
    reauth: true,
    setup: {
      mode: "url",
      url: "https://console.cloud.google.com/apis/credentials",
      label: "Open Google Cloud OAuth credentials",
      pendingTtlMs: 30 * 60 * 1000,
    },
    secretRefs: [
      { name: "GOOGLE_CLIENT_ID", scope: "project" },
      { name: "GOOGLE_CLIENT_SECRET", scope: "project" },
      { name: "GOOGLE_REFRESH_TOKEN", scope: "project" },
    ],
  },
];

function inboundSignalContext(
  ctx: ModuleContext,
  config: GoogleWorkspaceConfig,
): GoogleWorkspaceInboundSignalContext {
  const inbound = config.inbound ?? {};
  return {
    projectId: deriveDirectoryScopeId(ctx.cwd),
    accountId: inbound.accountId ?? config.userId ?? "me",
    receivedAt: new Date().toISOString(),
    trustedSenders: inbound.trustedSenders,
    blockedSenders: inbound.blockedSenders,
    trustedOrganizers: inbound.trustedOrganizers,
    blockedOrganizers: inbound.blockedOrganizers,
  };
}

function emitResponse(
  ctx: ModuleContext,
  signal: ReturnType<
    typeof gmailMessageToInboundSignal | typeof calendarEventChangeToInboundSignal
  >,
  res: Parameters<ModuleRouteHandler>[1],
): void {
  const emitted = emitGoogleWorkspaceInboundSignal(ctx.events, signal);
  if (!emitted.emitted) {
    jsonResponse(res, 400, { error: emitted.error });
    return;
  }

  jsonResponse(res, 200, {
    ok: true,
    event: inboundSignalReceived.name,
    projectId: emitted.payload.projectId,
    channel: emitted.payload.channel,
    sourceId: emitted.payload.sourceId,
    actorTrust: emitted.payload.actor.trust,
    listeners:
      ctx.events.listenerCount(inboundSignalReceived.name) +
      ctx.events.listenerCount("*"),
  });
}

function makeGmailInboundHandler(
  ctx: ModuleContext,
  config: GoogleWorkspaceConfig,
): ModuleRouteHandler {
  return async (req, res) => {
    let body: InboundSignalJsonObject;
    try {
      body = (await readBody(req)) as InboundSignalJsonObject;
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    const message = googleWorkspaceGmailMessageFromInboundRequest(body);
    if (!message.ok) {
      jsonResponse(res, 400, { error: message.error });
      return;
    }

    emitResponse(
      ctx,
      gmailMessageToInboundSignal(message.value, inboundSignalContext(ctx, config)),
      res,
    );
  };
}

function makeCalendarInboundHandler(
  ctx: ModuleContext,
  config: GoogleWorkspaceConfig,
): ModuleRouteHandler {
  return async (req, res) => {
    let body: InboundSignalJsonObject;
    try {
      body = (await readBody(req)) as InboundSignalJsonObject;
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    const calendarId = config.calendarId ?? "primary";
    const change = googleWorkspaceCalendarEventChangeFromInboundRequest(
      body,
      calendarId,
    );
    if (!change.ok) {
      jsonResponse(res, 400, { error: change.error });
      return;
    }

    emitResponse(
      ctx,
      calendarEventChangeToInboundSignal(
        change.value,
        inboundSignalContext(ctx, config),
      ),
      res,
    );
  };
}

function googleWorkspaceInboundRoutes(ctx: ModuleContext): RouteRegistration[] {
  const config = ctx.getModuleConfig<GoogleWorkspaceConfig>();
  if (!config?.inbound) return [];

  return [
    {
      method: "POST",
      path: "/api/webhooks/google-workspace/gmail",
      handler: makeGmailInboundHandler(ctx, config),
    },
    {
      method: "POST",
      path: "/api/webhooks/google-workspace/calendar",
      handler: makeCalendarInboundHandler(ctx, config),
    },
  ];
}

const googleWorkspaceModule: KotaModule = {
  name: "google-workspace",
  version: "1.0.0",
  description: "Gmail, Calendar, and Drive tools for agents",
  dependencies: ["inbound-signals"],
  setupRequirements: googleWorkspaceSetupRequirements,
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["clientId", "clientSecret", "refreshToken"],
    properties: {
      clientId: { type: "string", minLength: 1 },
      clientSecret: { type: "string", minLength: 1 },
      refreshToken: { type: "string", minLength: 1 },
      userId: { type: "string", minLength: 1 },
      calendarId: { type: "string", minLength: 1 },
      inbound: {
        type: "object",
        additionalProperties: false,
        properties: {
          accountId: { type: "string", minLength: 1 },
          trustedSenders: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          blockedSenders: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          trustedOrganizers: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          blockedOrganizers: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
        },
      },
    },
  },

  onLoad(ctx) {
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createGoogleWorkspaceReadinessSource({
        getConfig: () => ctx.getModuleConfig<GoogleWorkspaceConfig>(),
        getSecret: ctx.getSecret,
      }),
    );
  },

  tools(ctx: ModuleContext): ToolDef[] {
    const config = ctx.getModuleConfig<GoogleWorkspaceConfig>();

    if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
      ctx.log.warn(
        "Google Workspace module: modules.google-workspace.clientId, clientSecret, and refreshToken are required — module inactive",
      );
      return [];
    }

    const clientId = resolveSecretReference(config.clientId, ctx.getSecret);
    const clientSecret = resolveSecretReference(config.clientSecret, ctx.getSecret);
    const refreshToken = resolveSecretReference(config.refreshToken, ctx.getSecret);

    if (!clientId || !clientSecret || !refreshToken) {
      ctx.log.warn(
        "Google Workspace module: one or more required env vars are not set — module inactive",
      );
      return [];
    }

    const userId = config.userId ?? "me";
    const calendarId = config.calendarId ?? "primary";
    const getToken = () => getAccessToken(clientId, clientSecret, refreshToken);

    return [
      makeGmailListMessages(getToken, userId),
      makeGmailGetMessage(getToken, userId),
      makeGmailSend(getToken, userId),
      makeCalendarListEvents(getToken, calendarId),
      makeCalendarCreateEvent(getToken, calendarId),
      makeDriveListFiles(getToken),
      makeDriveReadFile(getToken),
    ];
  },

  routes: (ctx: ModuleContext): RouteRegistration[] =>
    googleWorkspaceInboundRoutes(ctx),
};

export default googleWorkspaceModule;
