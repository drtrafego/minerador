import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { campaigns, type FollowUpStep } from "@/db/schema/campaigns";
import { leads as leadsTable } from "@/db/schema/leads";
import {
  outreachThreads,
  outreachMessages,
  outreachQueue,
} from "@/db/schema/outreach";
import { browserRuns } from "@/db/schema/browser-runs";
import type { OutreachSendPayload } from "@/lib/queue/types";
import {
  canSend,
  incrementSendCount,
  type OutreachChannel,
} from "@/lib/outreach/rate-limit";
import { GmailNotConnectedError, sendEmail } from "@/lib/clients/gmail";
import {
  buildTemplateVars,
  renderTemplate,
} from "@/lib/outreach/template";
import {
  buildSmartFollowUpPrompt,
  type SmartFollowUpHistoryItem,
} from "@/lib/outreach/smart-followup-prompt";
import { generateSmartFollowUp } from "@/lib/clients/anthropic";
import {
  sendInstagramDM,
  InstagramBlockedError,
  InstagramHandleNotFoundError,
  InstagramNeedsReloginError,
} from "@/lib/clients/playwright-instagram";
import {
  sendLinkedInDM,
  LinkedInBlockedError,
  LinkedInNeedsReloginError,
  LinkedInProfileNotFoundError,
} from "@/lib/clients/playwright-linkedin";
import {
  loadBrowserSession,
  markBrowserSessionStale,
} from "@/lib/clients/browser/storage";
import {
  sendWhatsAppQRMessage,
  WhatsAppNotConnectedError,
  WhatsAppPhoneNotFoundError,
} from "@/lib/clients/whatsapp-qr";
import {
  sendWhatsAppAPIMessage,
  loadWhatsAppAPICredential,
  WhatsAppAPINotConfiguredError,
  WhatsAppAPIError,
} from "@/lib/clients/whatsapp-api";
import {
  sendUazAPIMessage,
  loadUazAPICredential,
  UazAPINotConfiguredError,
  UazAPIError,
  UazAPIPhoneNotFoundError,
} from "@/lib/clients/whatsapp-uazapi";

const MAX_ATTEMPTS = 3;

type CampaignRow = typeof campaigns.$inferSelect;
type ThreadRow = typeof outreachThreads.$inferSelect;
type LeadRow = typeof leadsTable.$inferSelect;
type DbOutreachChannel = "email" | "instagram_dm" | "linkedin_dm" | "whatsapp";

function tryLockQueueItem(queueItemId: string) {
  const lockUntil = new Date(Date.now() + 5 * 60 * 1000);
  return db.execute<{
    id: string;
    organization_id: string;
    thread_id: string;
    message_id: string | null;
    channel: string;
    step: number;
    attempts: number;
    scheduled_at: Date;
  }>(sql`
    UPDATE outreach_queue
    SET status = 'processing',
        locked_until = ${lockUntil},
        updated_at = now()
    WHERE id = ${queueItemId}
      AND status = 'pending'
    RETURNING id, organization_id, thread_id, message_id, channel, step, attempts, scheduled_at
  `);
}

function parseFollowUpSequence(value: unknown): FollowUpStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is FollowUpStep =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as FollowUpStep).dayOffset === "number" &&
        typeof (v as FollowUpStep).copy === "string",
    )
    .map((v) => ({ dayOffset: v.dayOffset, copy: v.copy }));
}

async function scheduleNextFollowUp(params: {
  campaign: CampaignRow | null;
  thread: ThreadRow;
  step: number;
  channel: DbOutreachChannel;
  subject: string;
  lead: LeadRow;
  now: Date;
}): Promise<void> {
  const { campaign, thread, step, channel, subject, lead, now } = params;
  const organizationId = thread.organizationId;
  const threadId = thread.id;

  const sequence = parseFollowUpSequence(campaign?.followUpSequence ?? []);
  const nextStepIndex = step + 1;
  const nextStep = sequence[nextStepIndex - 1];

  if (nextStep && campaign) {
    const vars = buildTemplateVars(lead);
    const fallbackBody = renderTemplate(nextStep.copy, vars);
    let nextBody = fallbackBody;

    if (campaign.smartFollowUp === true) {
      try {
        const historyRows = await db
          .select({
            direction: outreachMessages.direction,
            body: outreachMessages.body,
            sentAt: outreachMessages.sentAt,
            createdAt: outreachMessages.createdAt,
          })
          .from(outreachMessages)
          .where(eq(outreachMessages.threadId, threadId))
          .orderBy(asc(outreachMessages.createdAt));

        const history: SmartFollowUpHistoryItem[] = historyRows.map((row) => ({
          direction: row.direction,
          body: row.body,
          sentAt: row.sentAt ?? row.createdAt,
        }));

        const prompt = buildSmartFollowUpPrompt({
          lead,
          campaign,
          history,
          stepIndex: nextStepIndex - 1,
        });

        const generated = await generateSmartFollowUp(organizationId, prompt);
        const trimmed = generated.trim();
        if (trimmed.length > 0) {
          const rendered = renderTemplate(trimmed, vars);
          const hasResidualPlaceholder = rendered.includes("{{");
          if (rendered.trim().length > 20 && !hasResidualPlaceholder) {
            nextBody = rendered;
          } else {
            console.warn(
              `[outreach.send] smart follow up invalido (curto ou com placeholder residual), usando fallback (thread ${threadId})`,
            );
          }
        } else {
          console.warn(
            `[outreach.send] smart follow up vazio, usando fallback (thread ${threadId})`,
          );
        }
      } catch (err) {
        console.error(
          `[outreach.send] smart follow up falhou, usando fallback (thread ${threadId})`,
          err,
        );
      }
    }

    const scheduledAt = new Date(
      now.getTime() + nextStep.dayOffset * 24 * 60 * 60 * 1000,
    );

    const [nextMessage] = await db
      .insert(outreachMessages)
      .values({
        organizationId,
        threadId,
        direction: "outbound",
        status: "pending",
        step: nextStepIndex,
        subject: channel === "email" ? `Re: ${subject}` : null,
        body: nextBody,
      })
      .returning({ id: outreachMessages.id });

    if (nextMessage) {
      await db.insert(outreachQueue).values({
        organizationId,
        threadId,
        messageId: nextMessage.id,
        channel,
        step: nextStepIndex,
        payload: {},
        status: "pending",
        scheduledAt,
      });
    }

    await db
      .update(outreachThreads)
      .set({
        currentStep: nextStepIndex,
        followupCount: nextStepIndex,
        updatedAt: new Date(),
      })
      .where(eq(outreachThreads.id, threadId));
    return;
  }

  await db
    .update(outreachThreads)
    .set({
      status: "finished",
      currentStep: step,
      updatedAt: new Date(),
    })
    .where(eq(outreachThreads.id, threadId));
}

export async function handleOutreachSend(
  payload: OutreachSendPayload,
): Promise<void> {
  const { queueItemId } = payload;

  const locked = await tryLockQueueItem(queueItemId);
  const row = locked[0];
  if (!row) {
    console.log(`[outreach.send] item ${queueItemId} ja processado, skip`);
    return;
  }

  const organizationId = row.organization_id;
  const threadId = row.thread_id;
  const messageId = row.message_id;
  const channel = row.channel as OutreachChannel;
  const step = row.step;
  const attempts = row.attempts;

  const threadRows = await db
    .select()
    .from(outreachThreads)
    .where(eq(outreachThreads.id, threadId))
    .limit(1);
  const thread = threadRows[0];
  if (!thread) {
    await markQueueFailed(queueItemId, "thread nao encontrada");
    return;
  }

  if (thread.organizationId !== organizationId) {
    await markQueueFailed(queueItemId, "mismatch org");
    return;
  }

  const campaign = thread.campaignId
    ? (
        await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.id, thread.campaignId),
              eq(campaigns.organizationId, organizationId),
            ),
          )
          .limit(1)
      )[0] ?? null
    : null;

  const leadRows = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.id, thread.leadId),
        eq(leadsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  const lead = leadRows[0];
  if (!lead) {
    await markQueueFailed(queueItemId, "lead nao encontrado");
    await db
      .update(outreachThreads)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(outreachThreads.id, threadId));
    return;
  }

  const msgRows = messageId
    ? await db
        .select()
        .from(outreachMessages)
        .where(eq(outreachMessages.id, messageId))
        .limit(1)
    : [];
  const message = msgRows[0] ?? null;
  if (!message) {
    await markQueueFailed(queueItemId, "message nao encontrada");
    return;
  }

  // rate limit por campanha + canal
  if (thread.campaignId) {
    let sessionCreatedAt: number | null = null;
    if (channel === "instagram_dm" || channel === "linkedin_dm") {
      const provider =
        channel === "instagram_dm"
          ? "instagram_session"
          : "linkedin_session";
      const session = await loadBrowserSession(organizationId, provider);
      sessionCreatedAt = session ? session.sessionCreatedAt : null;
    }
    const decision = await canSend(
      organizationId,
      thread.campaignId,
      channel,
      { sessionCreatedAt },
    );
    if (!decision.allowed) {
      await db
        .update(outreachQueue)
        .set({
          status: "pending",
          scheduledAt: decision.nextAvailableAt,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(outreachQueue.id, queueItemId));
      console.log(
        `[outreach.send] rate limit (${decision.reason}) atingido, reagendado pra ${decision.nextAvailableAt.toISOString()}`,
      );
      return;
    }
  }

  try {
    if (channel === "email") {
      if (!lead.email) {
        await markMessageFailed(message.id, "sem email");
        await markQueueFailed(queueItemId, "sem email");
        await db
          .update(outreachThreads)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(outreachThreads.id, threadId));
        return;
      }

      const subject = message.subject ?? "Oportunidade";
      const result = await sendEmail({
        organizationId,
        to: lead.email,
        subject,
        body: message.body,
        threadId: thread.externalThreadId ?? undefined,
      });

      const now = new Date();
      await db
        .update(outreachMessages)
        .set({
          status: "sent",
          externalMessageId: result.messageId,
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(outreachMessages.id, message.id));

      await db
        .update(outreachThreads)
        .set({
          status: "active",
          lastMessageAt: now,
          lastOutboundAt: now,
          externalThreadId: thread.externalThreadId ?? result.threadId,
          updatedAt: now,
        })
        .where(eq(outreachThreads.id, threadId));

      await db
        .update(outreachQueue)
        .set({
          status: "sent",
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(outreachQueue.id, queueItemId));

      if (thread.campaignId) {
        await incrementSendCount(
          organizationId,
          thread.campaignId,
          channel,
          now,
        );
      }

      await scheduleNextFollowUp({
        campaign,
        thread,
        step,
        channel: channel as DbOutreachChannel,
        subject,
        lead,
        now,
      });
      return;
    }

    if (channel === "instagram_dm") {
      const session = await loadBrowserSession(
        organizationId,
        "instagram_session",
      );
      if (!session) {
        await markMessageFailed(message.id, "instagram nao conectado");
        const retryAt = new Date(Date.now() + 60 * 60 * 1000);
        await db
          .update(outreachQueue)
          .set({
            status: "pending",
            scheduledAt: retryAt,
            lockedUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(outreachQueue.id, queueItemId));
        return;
      }

      if (!lead.handle) {
        await markMessageFailed(message.id, "sem handle instagram");
        await markQueueFailed(queueItemId, "sem handle instagram");
        await db
          .update(outreachThreads)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(outreachThreads.id, threadId));
        return;
      }

      const igStartedAt = Date.now();
      try {
        const result = await sendInstagramDM({
          organizationId,
          handle: lead.handle,
          body: message.body,
        });

        const now = new Date();

        await db.insert(browserRuns).values({
          organizationId,
          credentialId: session.id,
          channel: "instagram_dm",
          status: "ok",
          threadId,
          messageId: message.id,
          durationMs: result.latencyMs,
          metadata: { externalThreadId: result.externalThreadId },
        });

        await db
          .update(outreachMessages)
          .set({
            status: "sent",
            externalMessageId: result.externalThreadId || null,
            sentAt: now,
            metadata: { latencyMs: result.latencyMs },
            updatedAt: now,
          })
          .where(eq(outreachMessages.id, message.id));

        await db
          .update(outreachThreads)
          .set({
            status: "active",
            lastMessageAt: now,
            lastOutboundAt: now,
            externalThreadId:
              thread.externalThreadId ?? result.externalThreadId ?? null,
            updatedAt: now,
          })
          .where(eq(outreachThreads.id, threadId));

        await db
          .update(outreachQueue)
          .set({
            status: "sent",
            lockedUntil: null,
            updatedAt: now,
          })
          .where(eq(outreachQueue.id, queueItemId));

        if (thread.campaignId) {
          await incrementSendCount(
            organizationId,
            thread.campaignId,
            channel,
            now,
          );
        }

        await scheduleNextFollowUp({
          campaign,
          thread,
          step,
          channel: "instagram_dm",
          subject: message.subject ?? "",
          lead,
          now,
        });
        return;
      } catch (err) {
        if (err instanceof InstagramNeedsReloginError) {
          await db.insert(browserRuns).values({
            organizationId,
            credentialId: session.id,
            channel: "instagram_dm",
            status: "needs_relogin",
            threadId,
            messageId: message.id,
            errorReason: err.message,
          });
          await markMessageFailed(
            message.id,
            "sessao invalida, religar instagram",
          );
          const retryAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
          await db
            .update(outreachQueue)
            .set({
              status: "pending",
              scheduledAt: retryAt,
              lockedUntil: null,
              updatedAt: new Date(),
            })
            .where(eq(outreachQueue.id, queueItemId));
          return;
        }

        if (err instanceof InstagramBlockedError) {
          await db.insert(browserRuns).values({
            organizationId,
            credentialId: session.id,
            channel: "instagram_dm",
            status: "blocked",
            threadId,
            messageId: message.id,
            errorReason: err.message,
          });
          await markBrowserSessionStale(organizationId, "instagram_session");
          const retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await db
            .update(outreachQueue)
            .set({
              status: "pending",
              scheduledAt: retryAt,
              lockedUntil: null,
              updatedAt: new Date(),
            })
            .where(eq(outreachQueue.id, queueItemId));
          return;
        }

        if (err instanceof InstagramHandleNotFoundError) {
          await db.insert(browserRuns).values({
            organizationId,
            credentialId: session.id,
            channel: "instagram_dm",
            status: "failed",
            threadId,
            messageId: message.id,
            errorReason: err.message,
          });
          await markMessageFailed(message.id, "handle nao encontrado");
          await markQueueFailed(queueItemId, "handle nao encontrado");
          await db
            .update(outreachThreads)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(outreachThreads.id, threadId));
          return;
        }

        // erro generico, registra browser_run failed antes de propagar
        const igErrMsg = err instanceof Error ? err.message : String(err);
        await db.insert(browserRuns).values({
          organizationId,
          credentialId: session.id,
          channel: "instagram_dm",
          status: "failed",
          threadId,
          messageId: message.id,
          durationMs: Date.now() - igStartedAt,
          errorReason: igErrMsg,
        });

        throw err;
      }
    }

    if (channel === "linkedin_dm") {
      const session = await loadBrowserSession(
        organizationId,
        "linkedin_session",
      );
      if (!session) {
        await markMessageFailed(message.id, "linkedin nao conectado");
        const retryAt = new Date(Date.now() + 60 * 60 * 1000);
        await db
          .update(outreachQueue)
          .set({
            status: "pending",
            scheduledAt: retryAt,
            lockedUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(outreachQueue.id, queueItemId));
        return;
      }

      if (!lead.linkedinUrl) {
        await markMessageFailed(message.id, "sem linkedin url");
        await markQueueFailed(queueItemId, "sem linkedin url");
        await db
          .update(outreachThreads)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(outreachThreads.id, threadId));
        return;
      }

      const liStartedAt = Date.now();
      try {
        const result = await sendLinkedInDM({
          organizationId,
          profileUrl: lead.linkedinUrl,
          body: message.body,
        });

        const now = new Date();

        await db.insert(browserRuns).values({
          organizationId,
          credentialId: session.id,
          channel: "linkedin_dm",
          status: "ok",
          threadId,
          messageId: message.id,
          durationMs: result.latencyMs,
          metadata: { externalThreadId: result.externalThreadId },
        });

        await db
          .update(outreachMessages)
          .set({
            status: "sent",
            externalMessageId: result.externalThreadId || null,
            sentAt: now,
            metadata: { latencyMs: result.latencyMs },
            updatedAt: now,
          })
          .where(eq(outreachMessages.id, message.id));

        await db
          .update(outreachThreads)
          .set({
            status: "active",
            lastMessageAt: now,
            lastOutboundAt: now,
            externalThreadId:
              thread.externalThreadId ?? result.externalThreadId ?? null,
            updatedAt: now,
          })
          .where(eq(outreachThreads.id, threadId));

        await db
          .update(outreachQueue)
          .set({
            status: "sent",
            lockedUntil: null,
            updatedAt: now,
          })
          .where(eq(outreachQueue.id, queueItemId));

        if (thread.campaignId) {
          await incrementSendCount(
            organizationId,
            thread.campaignId,
            channel,
            now,
          );
        }

        await scheduleNextFollowUp({
          campaign,
          thread,
          step,
          channel: "linkedin_dm",
          subject: message.subject ?? "",
          lead,
          now,
        });
        return;
      } catch (err) {
        if (err instanceof LinkedInNeedsReloginError) {
          await db.insert(browserRuns).values({
            organizationId,
            credentialId: session.id,
            channel: "linkedin_dm",
            status: "needs_relogin",
            threadId,
            messageId: message.id,
            errorReason: err.message,
          });
          await markMessageFailed(
            message.id,
            "sessao invalida, religar linkedin",
          );
          const retryAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
          await db
            .update(outreachQueue)
            .set({
              status: "pending",
              scheduledAt: retryAt,
              lockedUntil: null,
              updatedAt: new Date(),
            })
            .where(eq(outreachQueue.id, queueItemId));
          return;
        }

        if (err instanceof LinkedInBlockedError) {
          await db.insert(browserRuns).values({
            organizationId,
            credentialId: session.id,
            channel: "linkedin_dm",
            status: "blocked",
            threadId,
            messageId: message.id,
            errorReason: err.message,
          });
          await markBrowserSessionStale(organizationId, "linkedin_session");
          const retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await db
            .update(outreachQueue)
            .set({
              status: "pending",
              scheduledAt: retryAt,
              lockedUntil: null,
              updatedAt: new Date(),
            })
            .where(eq(outreachQueue.id, queueItemId));
          return;
        }

        if (err instanceof LinkedInProfileNotFoundError) {
          await db.insert(browserRuns).values({
            organizationId,
            credentialId: session.id,
            channel: "linkedin_dm",
            status: "failed",
            threadId,
            messageId: message.id,
            errorReason: err.message,
          });
          await markMessageFailed(message.id, "profile nao encontrado");
          await markQueueFailed(queueItemId, "profile nao encontrado");
          await db
            .update(outreachThreads)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(outreachThreads.id, threadId));
          return;
        }

        // erro generico, registra browser_run failed antes de propagar
        const liErrMsg = err instanceof Error ? err.message : String(err);
        await db.insert(browserRuns).values({
          organizationId,
          credentialId: session.id,
          channel: "linkedin_dm",
          status: "failed",
          threadId,
          messageId: message.id,
          durationMs: Date.now() - liStartedAt,
          errorReason: liErrMsg,
        });

        throw err;
      }
    }

    if (channel === "whatsapp") {
      if (!lead.phone) {
        await markMessageFailed(message.id, "lead sem numero de telefone");
        await markQueueFailed(queueItemId, "lead sem numero de telefone");
        await db
          .update(outreachThreads)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(outreachThreads.id, threadId));
        return;
      }

      const now = new Date();
      try {
        const apiCred = await loadWhatsAppAPICredential(organizationId);
        const uazapiCred = apiCred ? null : await loadUazAPICredential(organizationId);
        let waMessageId: string;

        if (apiCred) {
          // Prioridade 1: Meta Cloud API oficial
          const result = await sendWhatsAppAPIMessage({
            organizationId,
            phone: lead.phone,
            body: message.body,
          });
          waMessageId = result.messageId;
        } else if (uazapiCred) {
          // Prioridade 2: UazAPI (self-hosted ou cloud)
          const result = await sendUazAPIMessage({
            organizationId,
            phone: lead.phone,
            body: message.body,
          });
          waMessageId = result.messageId;
        } else {
          // Prioridade 3: Baileys QR direto
          const result = await sendWhatsAppQRMessage({
            organizationId,
            phone: lead.phone,
            body: message.body,
          });
          waMessageId = result.messageId;
        }

        await db
          .update(outreachMessages)
          .set({
            status: "sent",
            externalMessageId: waMessageId,
            sentAt: now,
            updatedAt: now,
          })
          .where(eq(outreachMessages.id, message.id));

        const followUpSeq = parseFollowUpSequence(campaign?.followUpSequence ?? []);
        const newStatus =
          step < followUpSeq.length - 1 ? "active" : "awaiting_reply";
        await db
          .update(outreachThreads)
          .set({
            status: newStatus,
            lastMessageAt: now,
            lastOutboundAt: now,
            updatedAt: now,
          })
          .where(eq(outreachThreads.id, threadId));

        await db
          .update(outreachQueue)
          .set({ status: "sent", updatedAt: now })
          .where(eq(outreachQueue.id, queueItemId));

        if (thread.campaignId) {
          await incrementSendCount(
            organizationId,
            thread.campaignId,
            "whatsapp" as OutreachChannel,
          );
        }
        await scheduleNextFollowUp({
          thread,
          step,
          channel,
          subject: message.subject ?? "",
          lead,
          campaign,
          now,
        });
        return;
      } catch (err) {
        if (
          err instanceof WhatsAppNotConnectedError ||
          err instanceof WhatsAppAPINotConfiguredError
        ) {
          const retryAt = new Date(Date.now() + 60 * 60 * 1000);
          await db
            .update(outreachQueue)
            .set({
              status: "pending",
              lockedUntil: null,
              scheduledAt: retryAt,
              attempts: attempts + 1,
              lastError: err.message,
              updatedAt: new Date(),
            })
            .where(eq(outreachQueue.id, queueItemId));
          return;
        }

        if (
          err instanceof UazAPINotConfiguredError
        ) {
          const retryAt = new Date(Date.now() + 60 * 60 * 1000);
          await db
            .update(outreachQueue)
            .set({
              status: "pending",
              lockedUntil: null,
              scheduledAt: retryAt,
              attempts: attempts + 1,
              lastError: err.message,
              updatedAt: new Date(),
            })
            .where(eq(outreachQueue.id, queueItemId));
          return;
        }

        if (err instanceof UazAPIPhoneNotFoundError) {
          await markMessageFailed(message.id, "numero nao encontrado");
          await markQueueFailed(queueItemId, "numero nao encontrado");
          await db
            .update(outreachThreads)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(outreachThreads.id, threadId));
          return;
        }

        if (err instanceof UazAPIError && err.statusCode >= 400 && err.statusCode < 500) {
          await markMessageFailed(message.id, err.message);
          await markQueueFailed(queueItemId, err.message);
          await db
            .update(outreachThreads)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(outreachThreads.id, threadId));
          return;
        }

        if (err instanceof WhatsAppPhoneNotFoundError) {
          await markMessageFailed(message.id, "numero nao encontrado");
          await markQueueFailed(queueItemId, "numero nao encontrado");
          await db
            .update(outreachThreads)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(outreachThreads.id, threadId));
          return;
        }

        if (
          err instanceof WhatsAppAPIError &&
          err.statusCode >= 400 &&
          err.statusCode < 500
        ) {
          await markMessageFailed(message.id, err.message);
          await markQueueFailed(queueItemId, err.message);
          await db
            .update(outreachThreads)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(outreachThreads.id, threadId));
          return;
        }

        throw err;
      }
    }

    await markQueueFailed(queueItemId, `canal ${channel} nao suportado`);
  } catch (err) {
    const reason =
      err instanceof GmailNotConnectedError
        ? "gmail nao conectado"
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`[outreach.send] erro no item ${queueItemId}`, reason);

    const newAttempts = attempts + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      await markMessageFailed(message.id, reason);
      await db
        .update(outreachQueue)
        .set({
          status: "failed",
          attempts: newAttempts,
          lastError: reason,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(outreachQueue.id, queueItemId));
      await db
        .update(outreachThreads)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(outreachThreads.id, threadId));
      return;
    }

    const backoffMs = newAttempts * 10 * 60 * 1000;
    const scheduledAt = new Date(Date.now() + backoffMs);
    await db
      .update(outreachQueue)
      .set({
        status: "pending",
        attempts: newAttempts,
        lastError: reason,
        lockedUntil: null,
        scheduledAt,
        updatedAt: new Date(),
      })
      .where(eq(outreachQueue.id, queueItemId));
  }
}

async function markQueueFailed(queueItemId: string, reason: string) {
  await db
    .update(outreachQueue)
    .set({
      status: "failed",
      lastError: reason,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(outreachQueue.id, queueItemId));
}

async function markMessageFailed(messageId: string, reason: string) {
  await db
    .update(outreachMessages)
    .set({
      status: "failed",
      errorReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(outreachMessages.id, messageId));
}
