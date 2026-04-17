/**
 * Email module — routes KOTA notification events to an operator email address via SMTP.
 *
 * Contributes:
 * - `email-alerts` channel (ChannelDef): validates SMTP on start; outbound-only in v1.
 * - Event subscriptions in onLoad: subscribes to workflow/module/approval bus events
 *   and sends formatted emails via nodemailer.
 *
 * Config (kota.config under the "email" key):
 *   {
 *     smtp: {
 *       host: string,
 *       port?: number,       // default 587
 *       secure?: boolean,    // default false (STARTTLS)
 *       auth?: { user: string, pass: string }
 *     },
 *     from: string,          // sender address
 *     to: string | string[], // recipient address(es)
 *     events?: string[]      // opt-in extra events; default: all notification events
 *   }
 *
 * Disabled gracefully when smtp.host is absent or empty.
 * Credentials are read from config; never logged.
 */

import type { ChannelDef } from "#core/channels/channel.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { formatEmail } from "./format.js";
import { createMailer, type Mailer } from "./mailer.js";

type SmtpAuthConfig = {
  user: string;
  pass: string;
};

type EmailConfig = {
  smtp: {
    host: string;
    port?: number;
    secure?: boolean;
    auth?: SmtpAuthConfig;
  };
  from: string;
  to: string | string[];
  /** Opt-in extra events (e.g. "workflow.build.committed"). Default: all notification events. */
  events?: string[];
};

const NOTIFICATION_EVENTS = [
  "workflow.failure.alert",
  "workflow.attention.digest",
  "workflow.approval.expired",
  "module.crash.alert",
  "approval.requested",
  "owner.question.asked",
] as const satisfies readonly (keyof BusEvents)[];

const OPT_IN_EVENTS = [
  "workflow.build.committed",
] as const satisfies readonly (keyof BusEvents)[];

function getConfig(ctx: ModuleContext): EmailConfig | null {
  const config = ctx.getModuleConfig<EmailConfig>();
  if (!config?.smtp?.host) return null;
  if (!config.from || !config.to) return null;
  return config;
}

let mailer: Mailer | null = null;
let unsubs: (() => void)[] = [];

function makeEmailSender(
  cfg: EmailConfig,
  log: ModuleContext["log"],
): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    if (!mailer) return;
    const { subject, text } = formatEmail(event, payload);
    mailer.send({ from: cfg.from, to: cfg.to, subject, text }).catch((err: unknown) => {
      log.warn(`email: failed to send (${event}): ${(err as Error).message}`);
    });
  };
}

const emailAlertsChannel: ChannelDef = {
  name: "email-alerts",
  description: "Outbound email alerts for workflow events via SMTP",
  create(ctx) {
    if (!mailer) return null;
    return {
      async start() {
        try {
          await mailer?.verify();
          ctx.log("[kota-email] SMTP connection verified");
        } catch (err) {
          ctx.log(`[kota-email] SMTP verify warning: ${(err as Error).message}`);
        }
      },
      stop() {
        // no-op: mailer is closed in onUnload
      },
    };
  },
};

const emailModule: KotaModule = {
  name: "email",
  version: "1.0.0",
  description: "Email notification channel for KOTA via SMTP",

  channels: [emailAlertsChannel],

  onLoad: (ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg) {
      ctx.log.warn("email module: smtp.host, from, and to are required — module inactive");
      return;
    }

    mailer = createMailer(cfg.smtp);
    const send = makeEmailSender(cfg, ctx.log);
    const optInEvents = new Set(cfg.events ?? []);

    unsubs = [
      ...NOTIFICATION_EVENTS.map((event) =>
        ctx.events.subscribe(event, (payload) => {
          send(event, payload as Record<string, unknown>);
        }),
      ),
      ...OPT_IN_EVENTS.filter((e) => optInEvents.has(e)).map((event) =>
        ctx.events.subscribe(event, (payload) => {
          send(event, payload as Record<string, unknown>);
        }),
      ),
    ];
  },

  onUnload: () => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
    mailer?.close();
    mailer = null;
  },
};

export default emailModule;
