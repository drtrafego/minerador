import "server-only";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { campaigns } from "@/db/schema/campaigns";
import { activities, pipelineStages, DEFAULT_PIPELINE_STAGES } from "@/db/schema/pipeline";

export type PipelineStageRow = typeof pipelineStages.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;

export async function ensureDefaultPipeline(organizationId: string): Promise<PipelineStageRow[]> {
  const existing = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.organizationId, organizationId))
    .orderBy(asc(pipelineStages.position));

  if (existing.length > 0) return existing;

  const rows = DEFAULT_PIPELINE_STAGES.map((s) => ({
    organizationId,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: Boolean(s.isWon),
    isLost: Boolean(s.isLost),
  }));

  const inserted = await db.insert(pipelineStages).values(rows).returning();
  return inserted.sort((a, b) => a.position - b.position);
}

export async function listPipelineStages(organizationId: string): Promise<PipelineStageRow[]> {
  return ensureDefaultPipeline(organizationId);
}

export type PipelineLeadCard = {
  id: string;
  displayName: string;
  company: string | null;
  city: string | null;
  temperature: "cold" | "warm" | "hot" | null;
  qualificationScore: number | null;
  pipelineStageId: string | null;
  campaignName: string | null;
  source: string;
  handle: string | null;
  updatedAt: Date;
};

export async function listPipelineLeads(organizationId: string): Promise<PipelineLeadCard[]> {
  const rows = await db
    .select({
      id: leads.id,
      displayName: leads.displayName,
      company: leads.company,
      city: leads.city,
      temperature: leads.temperature,
      qualificationScore: leads.qualificationScore,
      pipelineStageId: leads.pipelineStageId,
      source: leads.source,
      handle: leads.handle,
      updatedAt: leads.updatedAt,
      campaignName: campaigns.name,
    })
    .from(leads)
    .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
    .where(
      and(
        eq(leads.organizationId, organizationId),
        isNull(leads.deletedAt),
        or(
          eq(leads.qualificationStatus, "qualified"),
          eq(leads.qualificationStatus, "needs_review"),
        ),
      ),
    )
    .orderBy(desc(leads.updatedAt))
    .limit(500);

  return rows as PipelineLeadCard[];
}

export async function listLeadActivities(leadId: string, organizationId: string): Promise<ActivityRow[]> {
  return db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.leadId, leadId),
        eq(activities.organizationId, organizationId),
      ),
    )
    .orderBy(desc(activities.createdAt))
    .limit(200);
}
