/** SMTP-backed operator notification channel; credentials are never logged. */

import type { ChannelDef } from "#core/channels/channel.js";
import { resolveSecretReference } from "#core/config/secret-reference.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import { operatorSurfaceEffect } from "#core/tools/effect.js";
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
};

const NOTIFICATION_EVENTS = [
  "workflow.failure.alert",
  "workflow.attention.digest",
  "workflow.daily.digest",
  "workflow.approval.expired",
  "module.crash.alert",
  "approval.requested",
  "owner.question.asked",
] as const satisfies readonly (keyof BusEvents)[];

function getConfig(ctx: ModuleContext): EmailConfig | null {
  const config = ctx.getModuleConfig<EmailConfig>();
  if (!config?.smtp?.host) return null;
  if (!config.from || !config.to) return null;
  const auth = config.smtp.auth;
  if (!auth) return config;
  const user = resolveSecretReference(auth.user, ctx.getSecret);
  const pass = resolveSecretReference(auth.pass, ctx.getSecret);
  if (!user || !pass) return null;
  return {
    ...config,
    smtp: {
      ...config.smtp,
      auth: { user, pass },
    },
  };
}

let mailer: Mailer | null = null;
function makeEmailSender(
  cfg: EmailConfig,
  log: ModuleContext["log"],
  activeMailer: Mailer,
): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    const { subject, text } = formatEmail(event, payload);
    activeMailer.send({ from: cfg.from, to: cfg.to, subject, text }).catch((err: unknown) => {
      log.warn(`email: failed to send (${event}): ${(err as Error).message}`);
    });
  };
}

const emailAlertsChannel: ChannelDef = {
  name: "email-alerts",
  description: "Outbound email alerts for workflow events via SMTP",
  create(ctx) {
    if (!mailer) {
      return {
        status: "unavailable",
        reason: "SMTP is not configured — set email.smtp.host, email.from, and email.to to enable",
      };
    }
    return {
      status: "started",
      adapter: {
        listScopeSessionIds: () => [],
        async start() {
          try {
            await mailer?.verify();
            ctx.log("[kota-email] SMTP connection verified");
          } catch (err) {
            ctx.log(`[kota-email] SMTP verify warning: ${(err as Error).message}`);
          }
        },
        stop() {
          // no-op: the module activation disposer closes the mailer
        },
      },
    };
  },
};

const emailModule: KotaModule = {
  name: "email",
  version: "1.0.0",
  description: "Email notification channel for KOTA via SMTP",
  effects: [
    {
      id: "email.smtp-delivery",
      description: "Deliver workflow, approval, and owner-question notifications by SMTP email.",
      source: "notification",
      effect: operatorSurfaceEffect(),
      capabilityIds: ["email.notifications"],
    },
  ],
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "email.notifications",
        description:
          "Send KOTA workflow, approval, and owner-question notifications to configured email recipients.",
        scope: "external",
        scopePolicyHooks: ["channels", "external-effects", "setup"],
        setupRequirementIds: ["smtp-config", "smtp-credentials"],
      },
    ],
    dataClasses: [
      {
        id: "email.smtp-routing",
        description: "SMTP host, sender, recipient, and event-filter routing configuration.",
        sensitivity: "personal",
        retention: "scope-durable",
        redaction: "metadata-only",
      },
      {
        id: "email.smtp-credentials",
        description: "SMTP username and password references resolved through the shared secret provider.",
        sensitivity: "credential",
        retention: "scope-durable",
        redaction: "mask-secret",
      },
      {
        id: "email.notification-content",
        description: "Rendered workflow, approval, owner-question, and digest notification bodies.",
        sensitivity: "internal",
        retention: "operator-visible",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "SMTP delivery is operator-visible external I/O and is blocked in workflow trial mode.",
      ],
    },
  },
  setupRequirements: [
    {
      id: "smtp-config",
      kind: "config",
      title: "SMTP routing config",
      description:
        "Scope SMTP host and email routing fields used for operator notifications.",
      required: true,
      scope: "scope",
      owner: "email",
      sensitivity: "none",
      setup: {
        mode: "form",
        fields: [
          {
            id: "smtp-host",
            label: "SMTP host",
            type: "string",
            configPath: "modules.email.smtp.host",
            required: true,
            placeholder: "smtp.example.com",
          },
          {
            id: "from",
            label: "From address",
            type: "string",
            configPath: "modules.email.from",
            required: true,
            placeholder: "kota@example.com",
          },
          {
            id: "to",
            label: "To address",
            type: "string",
            configPath: "modules.email.to",
            required: true,
            placeholder: "operator@example.com",
          },
          {
            id: "smtp-port",
            label: "SMTP port",
            type: "number",
            configPath: "modules.email.smtp.port",
            required: false,
            placeholder: "587",
          },
          {
            id: "smtp-secure",
            label: "SMTP secure",
            type: "boolean",
            configPath: "modules.email.smtp.secure",
            required: false,
          },
          {
            id: "smtp-user-ref",
            label: "SMTP user reference",
            type: "string",
            valueKind: "secret-reference",
            configPath: "modules.email.smtp.auth.user",
            required: false,
            placeholder: "$SMTP_USER",
          },
          {
            id: "smtp-pass-ref",
            label: "SMTP password reference",
            type: "string",
            valueKind: "secret-reference",
            configPath: "modules.email.smtp.auth.pass",
            required: false,
            placeholder: "$SMTP_PASS",
          },
        ],
      },
    },
    {
      id: "smtp-credentials",
      kind: "secret",
      title: "SMTP credentials",
      description:
        "Optional SMTP username and password values stored through the shared secret provider.",
      required: false,
      scope: "scope",
      owner: "email",
      sensitivity: "secret",
      setup: {
        mode: "url",
        url: "https://nodemailer.com/smtp/",
        label: "Open SMTP setup guide",
        pendingTtlMs: 30 * 60 * 1000,
      },
      secretRefs: [
        { name: "SMTP_USER", scope: "scope" },
        { name: "SMTP_PASS", scope: "scope" },
      ],
    },
  ] satisfies ModuleSetupRequirement[],

  channels: [emailAlertsChannel],

  onLoad: (ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg) {
      ctx.log.warn("email module: smtp.host, from, and to are required — module inactive");
      return;
    }

    const activeMailer = createMailer(cfg.smtp);
    mailer = activeMailer;
    const send = makeEmailSender(cfg, ctx.log, activeMailer);
    const unsubs = [
      ...NOTIFICATION_EVENTS.map((event) =>
        ctx.events.subscribe(event, (payload) => {
          send(event, payload as Record<string, unknown>);
        }),
      ),
    ];
    return {
      dispose: () => {
        unsubs.forEach((unsubscribe) => unsubscribe());
        activeMailer.close();
        if (mailer === activeMailer) mailer = null;
      },
    };
  },
};

export default emailModule;
