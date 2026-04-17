import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { campaigns } from "@/db/schema/campaigns";
import { leads as leadsTable } from "@/db/schema/leads";
import { qualificationJobs } from "@/db/schema/jobs";
import { getOrgCredential } from "@/lib/credentials/get";
import {
  qualifyLeadsBatch,
  type LeadForQualification,
} from "@/lib/clients/anthropic";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type {
  OutreachEnqueuePayload,
  QualifyBatchPayload,
} from "@/lib/queue/types";

const DEFAULT_BATCH_SIZE = 20;

const DEFAULT_PROMPT = [
  "Avalie se o lead corresponde ao perfil ideal de cliente.",
  "Aprove apenas leads com claros sinais de aderencia ao ICP.",
].join(" ");

function buildLeadForQualification(
  row: typeof leadsTable.$inferSelect,
): LeadForQualification {
  const raw = (row.rawData ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    source: row.source,
    displayName: row.displayName,
    handle: row.handle,
    website: row.website,
    phone: row.phone,
    email: row.email,
    city: row.city,
    region: row.region,
    country: row.country,
    bio: typeof raw.bio === "string" ? (raw.bio as string) : null,
    followers:
      typeof raw.followers === "number" ? (raw.followers as number) : null,
    category:
      typeof raw.category === "string" ? (raw.category as string) : null,
    rating: typeof raw.rating === "number" ? (raw.rating as number) : null,
    userRatingsTotal:
      typeof raw.userRatingsTotal === "number"
        ? (raw.userRatingsTotal as number)
        : null,
    types: Array.isArray(raw.types) ? (raw.types as string[]) : undefined,
  };
}

export async function handleQualifyBatch(
  payload: QualifyBatchPayload,
): Promise<void> {
  const { organizationId, campaignId } = payload;
  const batchSize = payload.batchSize ?? DEFAULT_BATCH_SIZE;

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

  const pendingLeads = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.organizationId, organizationId),
        eq(leadsTable.campaignId, campaignId),
        eq(leadsTable.qualificationStatus, "pending"),
      ),
    )
    .limit(batchSize);

  if (pendingLeads.length === 0) return;

  const cred = await getOrgCredential(organizationId, "anthropic");
  const model = campaign.qualificationModel ?? "claude-sonnet-4-5";
  const prompt = campaign.qualificationPrompt ?? DEFAULT_PROMPT;

  const inputs = pendingLeads.map((row) => buildLeadForQualification(row));

  const jobIds: string[] = [];
  for (const lead of pendingLeads) {
    const [jobRow] = await db
      .insert(qualificationJobs)
      .values({
        organizationId,
        campaignId,
        leadId: lead.id,
        status: "running",
        model,
        startedAt: new Date(),
      })
      .returning({ id: qualificationJobs.id });
    if (jobRow) jobIds.push(jobRow.id);
  }

  let result;
  try {
    result = await qualifyLeadsBatch({
      apiKey: cred.apiKey,
      leads: inputs,
      prompt,
      model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = new Date();
    await db
      .update(leadsTable)
      .set({
        qualificationStatus: "needs_review",
        qualificationReason: `erro de qualificacao: ${message}`,
        updatedAt: failedAt,
      })
      .where(
        inArray(
          leadsTable.id,
          pendingLeads.map((l) => l.id),
        ),
      );
    for (const jobId of jobIds) {
      await db
        .update(qualificationJobs)
        .set({
          status: "failed",
          error: message,
          finishedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(qualificationJobs.id, jobId));
    }
    throw err;
  }

  const decisionByLead = new Map(
    result.decisions.map((d) => [d.leadId, d] as const),
  );

  const hasInitialCopy = (campaign.initialCopy ?? "").trim().length > 0;

  const now = new Date();
  const sharedTokens = Math.floor(
    result.usage.inputTokens / Math.max(pendingLeads.length, 1),
  );
  const sharedOutput = Math.floor(
    result.usage.outputTokens / Math.max(pendingLeads.length, 1),
  );
  const sharedCost =
    result.usage.costUsd / Math.max(pendingLeads.length, 1);

  for (let i = 0; i < pendingLeads.length; i++) {
    const lead = pendingLeads[i];
    if (!lead) continue;
    const decision = decisionByLead.get(lead.id);
    const jobId = jobIds[i];

    if (!decision) {
      if (jobId) {
        await db
          .update(qualificationJobs)
          .set({
            status: "failed",
            error: "claude nao retornou decisao para este lead",
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(qualificationJobs.id, jobId));
      }
      continue;
    }

    const status =
      decision.decision === "approved" ? "qualified" : "disqualified";

    await db
      .update(leadsTable)
      .set({
        qualificationStatus: status,
        qualificationScore: decision.score,
        qualificationReason: decision.reason,
        qualifiedAt: now,
        updatedAt: now,
      })
      .where(eq(leadsTable.id, lead.id));

    if (jobId) {
      await db
        .update(qualificationJobs)
        .set({
          status: "completed",
          promptTokens: sharedTokens,
          completionTokens: sharedOutput,
          costUsd: sharedCost.toFixed(6),
          result: {
            decision: decision.decision,
            score: decision.score,
            reason: decision.reason,
          },
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(qualificationJobs.id, jobId));
    }

    if (status === "qualified" && hasInitialCopy) {
      try {
        const boss = await getBoss();
        const enqueuePayload: OutreachEnqueuePayload = {
          organizationId,
          leadId: lead.id,
          campaignId,
        };
        await boss.send(QUEUES.outreachEnqueue, enqueuePayload);
      } catch (err) {
        console.error(
          `[qualify.batch] falha ao emitir outreach.enqueue pro lead ${lead.id}`,
          err,
        );
      }
    }
  }

  const remaining = await db
    .select({ id: leadsTable.id })
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.organizationId, organizationId),
        eq(leadsTable.campaignId, campaignId),
        eq(leadsTable.qualificationStatus, "pending"),
      ),
    )
    .limit(1);

  if (remaining.length > 0) {
    const boss = await getBoss();
    const next: QualifyBatchPayload = {
      organizationId,
      campaignId,
      batchSize,
    };
    await boss.send(QUEUES.qualifyBatch, next, {
      singletonKey: `qualify:${organizationId}:${campaignId}`,
      singletonNextSlot: true,
    });
  }
}
