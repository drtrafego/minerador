import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { campaigns, campaignSources } from "@/db/schema/campaigns";
import { leads } from "@/db/schema/leads";
import { scrapingJobs } from "@/db/schema/jobs";

export type CampaignListItem = {
  id: string;
  name: string;
  niche: string | null;
  status: "draft" | "active" | "paused" | "archived";
  createdAt: Date;
  totalLeads: number;
  qualifiedLeads: number;
  disqualifiedLeads: number;
  pendingLeads: number;
  primarySource: string | null;
};

export async function listCampaigns(
  organizationId: string,
): Promise<CampaignListItem[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      niche: campaigns.niche,
      status: campaigns.status,
      createdAt: campaigns.createdAt,
      totalLeads: sql<number>`coalesce(count(${leads.id}), 0)::int`,
      qualifiedLeads: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'qualified' then 1 else 0 end), 0)::int`,
      disqualifiedLeads: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'disqualified' then 1 else 0 end), 0)::int`,
      pendingLeads: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'pending' then 1 else 0 end), 0)::int`,
    })
    .from(campaigns)
    .leftJoin(leads, eq(leads.campaignId, campaigns.id))
    .where(eq(campaigns.organizationId, organizationId))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt));

  const sourceRows = await db
    .select({
      campaignId: campaignSources.campaignId,
      type: campaignSources.type,
    })
    .from(campaignSources)
    .where(eq(campaignSources.organizationId, organizationId));

  const sourceByCampaign = new Map<string, string>();
  for (const s of sourceRows) {
    if (!sourceByCampaign.has(s.campaignId)) {
      sourceByCampaign.set(s.campaignId, s.type);
    }
  }

  return rows.map((r) => ({
    ...r,
    primarySource: sourceByCampaign.get(r.id) ?? null,
  }));
}

export async function getCampaignById(
  organizationId: string,
  campaignId: string,
) {
  const rows = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getCampaignSources(
  organizationId: string,
  campaignId: string,
) {
  return db
    .select()
    .from(campaignSources)
    .where(
      and(
        eq(campaignSources.campaignId, campaignId),
        eq(campaignSources.organizationId, organizationId),
      ),
    );
}

export async function getCampaignScrapingJobs(
  organizationId: string,
  campaignId: string,
) {
  return db
    .select()
    .from(scrapingJobs)
    .where(
      and(
        eq(scrapingJobs.campaignId, campaignId),
        eq(scrapingJobs.organizationId, organizationId),
      ),
    )
    .orderBy(desc(scrapingJobs.createdAt))
    .limit(20);
}

export async function getCampaignCounters(
  organizationId: string,
  campaignId: string,
) {
  const rows = await db
    .select({
      total: sql<number>`coalesce(count(*), 0)::int`,
      qualified: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'qualified' then 1 else 0 end), 0)::int`,
      disqualified: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'disqualified' then 1 else 0 end), 0)::int`,
      pending: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'pending' then 1 else 0 end), 0)::int`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.campaignId, campaignId),
      ),
    );

  return rows[0] ?? { total: 0, qualified: 0, disqualified: 0, pending: 0 };
}
