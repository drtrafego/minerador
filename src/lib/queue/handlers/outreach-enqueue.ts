import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { campaigns } from "@/db/schema/campaigns";
import { leads as leadsTable } from "@/db/schema/leads";
import {
  outreachThreads,
  outreachMessages,
  outreachQueue,
} from "@/db/schema/outreach";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type {
  OutreachEnqueuePayload,
  OutreachSendPayload,
} from "@/lib/queue/types";
import {
  buildTemplateVars,
  renderTemplate,
} from "@/lib/outreach/template";

function resolveChannel(
  source: string,
): "email" | "instagram_dm" | "linkedin_dm" | null {
  if (source === "google_places") return "email";
  if (source === "instagram") return "instagram_dm";
  if (source === "linkedin") return "linkedin_dm";
  return null;
}

function jitterMs(maxSeconds = 30): number {
  return Math.floor(Math.random() * maxSeconds * 1000);
}

export async function handleOutreachEnqueue(
  payload: OutreachEnqueuePayload,
): Promise<void> {
  const { organizationId, leadId, campaignId } = payload;

  const leadRows = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.id, leadId),
        eq(leadsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  const lead = leadRows[0];
  if (!lead) {
    console.warn(`[outreach.enqueue] lead ${leadId} nao encontrado`);
    return;
  }

  if (lead.qualificationStatus !== "qualified") {
    console.warn(
      `[outreach.enqueue] lead ${leadId} nao esta qualified (${lead.qualificationStatus})`,
    );
    return;
  }

  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  const campaign = campaignRows[0];
  if (!campaign) {
    throw new Error(`campaign ${campaignId} nao encontrada`);
  }

  const initialCopy = campaign.initialCopy?.trim();
  if (!initialCopy) {
    console.warn(
      `[outreach.enqueue] campaign ${campaignId} sem initialCopy, ignorando`,
    );
    return;
  }

  const channel = resolveChannel(lead.source);
  if (!channel) {
    console.warn(
      `[outreach.enqueue] source ${lead.source} nao suportado`,
    );
    return;
  }

  const existingThread = await db
    .select({ id: outreachThreads.id })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        eq(outreachThreads.leadId, leadId),
        eq(outreachThreads.campaignId, campaignId),
      ),
    )
    .limit(1);

  if (existingThread.length > 0) {
    console.warn(
      `[outreach.enqueue] thread ja existe pro lead ${leadId}`,
    );
    return;
  }

  const vars = buildTemplateVars(lead);
  const body = renderTemplate(initialCopy, vars);
  const subject = `Ola ${vars.first_name || vars.name || "tudo bem"}`.trim();

  const result = await db.transaction(async (tx) => {
    const [thread] = await tx
      .insert(outreachThreads)
      .values({
        organizationId,
        campaignId,
        leadId,
        channel,
        status: "queued",
        currentStep: 0,
      })
      .returning({ id: outreachThreads.id });
    if (!thread) throw new Error("falha ao criar outreach_thread");

    const [message] = await tx
      .insert(outreachMessages)
      .values({
        organizationId,
        threadId: thread.id,
        direction: "outbound",
        status: "pending",
        step: 0,
        subject,
        body,
      })
      .returning({ id: outreachMessages.id });
    if (!message) throw new Error("falha ao criar outreach_message");

    const scheduledAt = new Date(Date.now() + jitterMs(30));
    const [queueItem] = await tx
      .insert(outreachQueue)
      .values({
        organizationId,
        threadId: thread.id,
        messageId: message.id,
        channel,
        step: 0,
        payload: {},
        status: "pending",
        scheduledAt,
      })
      .returning({ id: outreachQueue.id, scheduledAt: outreachQueue.scheduledAt });
    if (!queueItem) throw new Error("falha ao criar outreach_queue item");

    return { queueItemId: queueItem.id, scheduledAt: queueItem.scheduledAt };
  });

  const boss = await getBoss();
  const sendPayload: OutreachSendPayload = { queueItemId: result.queueItemId };
  const startAfterMs = Math.max(
    0,
    result.scheduledAt.getTime() - Date.now(),
  );
  await boss.send(QUEUES.outreachSend, sendPayload, {
    startAfter: Math.floor(startAfterMs / 1000),
  });
}
