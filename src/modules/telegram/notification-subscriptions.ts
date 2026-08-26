import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { pendingApprovalMessageKey } from "./approval-callback.js";
import { pendingApprovalMessages, pendingOwnerQuestionMessages } from "./channels.js";
import { compactOwnerQuestionContext, eventProjectId, renderProjectLabelPrefix, sendApprovalMessage, sendOwnerQuestionMessage, sendTelegramMessage, sendTelegramProjectMessage } from "./notification-delivery.js";
import { resolveTelegramProjectRouting, tryResolveTelegramClient } from "./project-routing.js";
import { createTelegramReadinessSource, getCredentials, reportedTelegramPollConflicts, type TelegramConfig } from "./readiness.js";

let notificationUnsubs: (() => void)[] = [];

export function loadTelegramModule(ctx: ModuleRuntimeContext): void {
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createTelegramReadinessSource(ctx),
    );
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const chatProjectBindings = telegramConfig?.chatProjectBindings ?? [];

    notificationUnsubs = [
      ctx.events.subscribe("workflow.failure.alert", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("workflow.attention.digest", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("workflow.daily.digest", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("workflow.approval.expired", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        void sendTelegramProjectMessage(
          creds.token,
          creds.chatId,
          payload.text as string,
          eventProjectId(payload),
          resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
          ctx.log,
        );
      }),
      ctx.events.subscribe("module.crash.alert", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        void sendTelegramMessage(creds.token, creds.chatId, payload.text as string, ctx.log);
      }),
      ctx.events.subscribe("approval.requested", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        const id = payload.id as string;
        const projectId = payload.projectId as string;
        void (async () => {
          const client = tryResolveTelegramClient(ctx);
          if (!client) return null;
          const listed = await client.forProject(projectId).approvals.list({ status: "pending" });
          const approval = listed.approvals.find((item) => item.id === id);
          if (!approval) return null;
          return sendApprovalMessage(
            creds.token,
            creds.chatId,
            approval,
            await renderProjectLabelPrefix(
              projectId,
              resolveTelegramProjectRouting(ctx, chatProjectBindings)?.selection,
              ctx.log,
            ),
            ctx.log,
          );
        })().then(
          (delivery) => {
            if (delivery != null) {
              pendingApprovalMessages.set(
                pendingApprovalMessageKey(creds.chatId, delivery.messageId),
                {
                  approvalId: id,
                  chatId: creds.chatId,
                  messageId: delivery.messageId,
                  projectId,
                  reviewDigest: delivery.reviewDigest,
                },
              );
            }
          },
        );
      }),
      ctx.events.subscribe("owner.question.asked", (payload) => {
        const creds = getCredentials(ctx);
        if (!creds) return;
        const id = payload.id as string;
        const question = payload.question as string;
        const reason = payload.reason as string;
        const source = payload.source as string;
        const projectId = payload.projectId as string;
        const payloadProposedAnswers = Array.isArray(payload.proposedAnswers)
          ? payload.proposedAnswers.filter((answer): answer is string => typeof answer === "string")
          : [];
        void (async () => {
          const projectRouting = resolveTelegramProjectRouting(ctx, chatProjectBindings);
          const listed = projectRouting
            ? await projectRouting.client.forProject(projectId).ownerQuestions.list()
            : { questions: [] };
          const entry = listed.questions.find((question) => question.id === id);
          const proposedAnswers = payloadProposedAnswers.length > 0
            ? payloadProposedAnswers
            : entry?.proposedAnswers ?? [];
          const messageId = await sendOwnerQuestionMessage(
            creds.token,
            creds.chatId,
            id,
            question,
            reason,
            source,
            compactOwnerQuestionContext(payload.context ?? entry?.context),
            payload.answerBehavior ?? entry?.answerBehavior,
            payload.origin ?? entry?.origin,
            proposedAnswers,
            await renderProjectLabelPrefix(projectId, projectRouting?.selection, ctx.log),
            ctx.log,
          );
          if (messageId != null) {
            pendingOwnerQuestionMessages.set(id, {
              chatId: creds.chatId,
              messageId,
              projectId,
              proposedAnswers,
            });
          }
        })();
      }),
    ];
}

export function unloadTelegramModule(): void {
  reportedTelegramPollConflicts.clear();
  pendingApprovalMessages.clear();
  pendingOwnerQuestionMessages.clear();
  for (const unsubscribe of notificationUnsubs) unsubscribe();
  notificationUnsubs = [];
}
