/**
 * Google Workspace module — Gmail, Calendar, and Drive tools for agents.
 *
 * Config (under modules.google-workspace):
 *   clientId:     OAuth 2.0 client ID or $ENV_VAR reference. Required.
 *   clientSecret: OAuth 2.0 client secret or $ENV_VAR reference. Required.
 *   refreshToken: OAuth 2.0 refresh token or $ENV_VAR reference. Required.
 *   userId:       Gmail/Calendar user (default: "me")
 *   calendarId:   Calendar ID (default: "primary")
 *
 * Auth setup:
 *   1. Create an OAuth 2.0 client in Google Cloud Console (Desktop app type).
 *   2. Enable Gmail API, Google Calendar API, and Google Drive API.
 *   3. Run the OAuth consent flow to get a refresh token with scopes:
 *      https://www.googleapis.com/auth/gmail.modify
 *      https://www.googleapis.com/auth/calendar
 *      https://www.googleapis.com/auth/drive.readonly
 *   4. Store credentials in .kota/config.json under modules.google-workspace,
 *      or use $ENV_VAR references to environment variables.
 */

import type { KotaModule, ModuleContext, ToolDef } from "#core/modules/module-types.js";
import { getAccessToken, resolveEnv } from "./auth.js";
import { makeCalendarCreateEvent, makeCalendarListEvents } from "./calendar.js";
import { makeDriveListFiles, makeDriveReadFile } from "./drive.js";
import { makeGmailGetMessage, makeGmailListMessages, makeGmailSend } from "./gmail.js";

type GoogleWorkspaceConfig = {
  /** OAuth 2.0 client ID or $ENV_VAR reference. Required. */
  clientId: string;
  /** OAuth 2.0 client secret or $ENV_VAR reference. Required. */
  clientSecret: string;
  /** OAuth 2.0 refresh token or $ENV_VAR reference. Required. */
  refreshToken: string;
  /** Gmail user ID (default: "me") */
  userId?: string;
  /** Calendar ID (default: "primary") */
  calendarId?: string;
};

const googleWorkspaceModule: KotaModule = {
  name: "google-workspace",
  version: "1.0.0",
  description: "Gmail, Calendar, and Drive tools for agents",

  tools(ctx: ModuleContext): ToolDef[] {
    const config = ctx.getModuleConfig<GoogleWorkspaceConfig>();

    if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
      ctx.log.warn(
        "Google Workspace module: modules.google-workspace.clientId, clientSecret, and refreshToken are required — module inactive",
      );
      return [];
    }

    const clientId = resolveEnv(config.clientId);
    const clientSecret = resolveEnv(config.clientSecret);
    const refreshToken = resolveEnv(config.refreshToken);

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
};

export default googleWorkspaceModule;
