import { eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { leads as leadsTable } from "@/db/schema/leads";
import { scrapingJobs } from "@/db/schema/jobs";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { QualifyBatchPayload, ScrapeIngestPayload } from "@/lib/queue/types";

export async function handleScrapeIngest(
  payload: ScrapeIngestPayload,
): Promise<void> {
  const { organizationId, campaignId, leads, scrapingJobId } = payload;

  let insertedCount = 0;

  if (leads.length > 0) {
    const leadsToInsert = leads.map((lead) => ({
      organizationId,
      campaignId,
      source: lead.source,
      externalId: lead.externalId,
      displayName: lead.displayName,
      handle: lead.handle ?? null,
      website: lead.website ?? null,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      city: lead.city ?? null,
      region: lead.region ?? null,
      country: lead.country ?? null,
      linkedinUrl: lead.linkedinUrl ?? null,
      headline: lead.headline ?? null,
      company: lead.company ?? null,
      rawData: lead.rawData,
      qualificationStatus: "pending" as const,
    }));

    const inserted = await db
      .insert(leadsTable)
      .values(leadsToInsert)
      .onConflictDoNothing({
        target: [
          leadsTable.organizationId,
          leadsTable.source,
          leadsTable.externalId,
        ],
      })
      .returning({ id: leadsTable.id });

    insertedCount = inserted.length;
  }

  await db
    .update(scrapingJobs)
    .set({ leadsInserted: insertedCount, updatedAt: new Date() })
    .where(eq(scrapingJobs.id, scrapingJobId));

  if (insertedCount > 0) {
    const boss = await getBoss();
    const qualifyPayload: QualifyBatchPayload = {
      organizationId,
      campaignId,
    };
    await boss.send(QUEUES.qualifyBatch, qualifyPayload, {
      singletonKey: `qualify:${organizationId}:${campaignId}`,
      singletonNextSlot: true,
    });
  }
}
