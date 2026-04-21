import "server-only";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads, type leadQualificationStatusEnum } from "@/db/schema/leads";
import { campaigns } from "@/db/schema/campaigns";

type Status = (typeof leadQualificationStatusEnum.enumValues)[number];

export type LeadRow = typeof leads.$inferSelect & {
  campaignName: string | null;
};

export async function listLeads(opts: {
  organizationId: string;
  campaignId?: string;
  status?: Status | "all";
  limit?: number;
}): Promise<LeadRow[]> {
  const conditions: SQL[] = [eq(leads.organizationId, opts.organizationId)];
  if (opts.campaignId) {
    conditions.push(eq(leads.campaignId, opts.campaignId));
  }
  if (opts.status && opts.status !== "all") {
    conditions.push(eq(leads.qualificationStatus, opts.status));
  }

  const rows = await db
    .select({
      lead: leads,
      campaignName: campaigns.name,
    })
    .from(leads)
    .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
    .where(and(...conditions))
    .orderBy(desc(leads.createdAt))
    .limit(opts.limit ?? 200);

  return rows.map((r) => ({ ...r.lead, campaignName: r.campaignName }));
}

export async function getLead(opts: {
  organizationId: string;
  leadId: string;
}): Promise<LeadRow | null> {
  const rows = await db
    .select({
      lead: leads,
      campaignName: campaigns.name,
    })
    .from(leads)
    .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
    .where(and(eq(leads.organizationId, opts.organizationId), eq(leads.id, opts.leadId)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r.lead, campaignName: r.campaignName };
}
