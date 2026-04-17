"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { campaigns, campaignSources } from "@/db/schema/campaigns";
import { requireOrg } from "@/lib/auth/guards";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { ScrapeRunPayload } from "@/lib/queue/types";

const sourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("google_places"),
    query: z.string().min(1),
    location: z.string().optional(),
    radius: z.coerce.number().int().positive().optional(),
    maxResults: z.coerce.number().int().positive().max(200).optional(),
  }),
  z.object({
    type: z.literal("instagram_hashtag"),
    search: z.string().min(1),
    maxResults: z.coerce.number().int().positive().max(200).optional(),
  }),
  z.object({
    type: z.literal("linkedin_search"),
    query: z.string().min(1),
    maxResults: z.coerce.number().int().positive().max(200).optional(),
  }),
]);

const followUpStepSchema = z.object({
  dayOffset: z.coerce.number().int().min(0).max(90),
  copy: z.string().min(1).max(5000),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  niche: z.string().min(1).max(200),
  qualificationPrompt: z.string().min(10),
  qualificationModel: z.string().min(1).default("claude-sonnet-4-5"),
  initialCopy: z.string().max(5000).optional().default(""),
  followUpSequence: z.array(followUpStepSchema).max(10).optional().default([]),
  smartFollowUp: z.boolean().default(false),
  source: sourceSchema,
});

export type CreateCampaignInput = z.infer<typeof createSchema>;

export async function createCampaign(input: CreateCampaignInput) {
  const { organizationId } = await requireOrg();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const data = parsed.data;
  const sourceConfig: Record<string, unknown> =
    data.source.type === "google_places"
      ? {
          query: data.source.query,
          location: data.source.location,
          radius: data.source.radius,
          maxResults: data.source.maxResults ?? 60,
        }
      : data.source.type === "instagram_hashtag"
        ? {
            search: data.source.search,
            maxResults: data.source.maxResults ?? 30,
          }
        : {
            query: data.source.query,
            maxResults: data.source.maxResults ?? 50,
          };

  const sourceType =
    data.source.type === "google_places"
      ? "google_places"
      : data.source.type === "instagram_hashtag"
        ? "instagram_hashtag"
        : "linkedin_search";

  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        organizationId,
        name: data.name,
        niche: data.niche,
        qualificationPrompt: data.qualificationPrompt,
        qualificationModel: data.qualificationModel,
        initialCopy: data.initialCopy?.trim() ? data.initialCopy.trim() : null,
        followUpSequence: data.followUpSequence ?? [],
        smartFollowUp: data.smartFollowUp ?? false,
        status: "draft",
      })
      .returning({ id: campaigns.id });

    if (!campaign) throw new Error("falha ao criar campanha");

    const [source] = await tx
      .insert(campaignSources)
      .values({
        organizationId,
        campaignId: campaign.id,
        type: sourceType,
        config: sourceConfig,
      })
      .returning({ id: campaignSources.id });

    if (!source) throw new Error("falha ao criar source");

    return { campaignId: campaign.id, sourceId: source.id };
  });

  revalidatePath("/campaigns");
  return { ok: true, ...result };
}

export async function startCampaign(campaignId: string) {
  const { organizationId } = await requireOrg();

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

  if (campaignRows.length === 0) {
    return { error: "campanha nao encontrada" };
  }

  const sources = await db
    .select()
    .from(campaignSources)
    .where(
      and(
        eq(campaignSources.campaignId, campaignId),
        eq(campaignSources.organizationId, organizationId),
      ),
    );

  try {
    const boss = await getBoss();
    for (const source of sources) {
      const payload: ScrapeRunPayload = {
        organizationId,
        campaignId,
        sourceId: source.id,
      };
      await boss.send(QUEUES.scrapeRun, payload);
    }

    await db
      .update(campaigns)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true };
  } catch (err) {
    console.error("[startCampaign]", err);
    return { error: "falha ao iniciar campanha, tente novamente" };
  }
}

export async function pauseCampaign(campaignId: string) {
  const { organizationId } = await requireOrg();

  const found = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (found.length === 0) return { error: "campanha nao encontrada" };

  await db
    .update(campaigns)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function resumeCampaign(campaignId: string) {
  return startCampaign(campaignId);
}

export async function deleteCampaign(campaignId: string) {
  const { organizationId } = await requireOrg();

  const found = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (found.length === 0) return { error: "campanha nao encontrada" };

  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function createAndStartCampaign(input: CreateCampaignInput) {
  const created = await createCampaign(input);
  if ("error" in created) return created;
  if (!created.ok || !created.campaignId) return { error: "falha ao criar" };
  const started = await startCampaign(created.campaignId);
  if ("error" in started && started.error) {
    return { ...created, startError: started.error };
  }
  return { ok: true, campaignId: created.campaignId };
}
