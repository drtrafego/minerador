import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { campaignSources } from "@/db/schema/campaigns";
import { scrapingJobs } from "@/db/schema/jobs";
import { getOrgCredential } from "@/lib/credentials/get";
import { searchPlaces } from "@/lib/clients/google-places";
import {
  searchInstagramAndScrape,
  searchLinkedInProfiles,
  type IgLead,
  type LinkedInProfile,
} from "@/lib/clients/apify";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type {
  NormalizedLead,
  ScrapeIngestPayload,
  ScrapeRunPayload,
} from "@/lib/queue/types";

type GooglePlacesConfig = {
  query: string;
  location?: string;
  radius?: number;
  maxResults?: number;
};

type ApifyInstagramConfig = {
  search: string;
  maxResults?: number;
};

type LinkedInSearchConfig = {
  query: string;
  maxResults?: number;
};

function isGooglePlacesConfig(c: unknown): c is GooglePlacesConfig {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Record<string, unknown>).query === "string"
  );
}

function isApifyInstagramConfig(c: unknown): c is ApifyInstagramConfig {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Record<string, unknown>).search === "string"
  );
}

function isLinkedInSearchConfig(c: unknown): c is LinkedInSearchConfig {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Record<string, unknown>).query === "string"
  );
}

export async function handleScrapeRun(payload: ScrapeRunPayload): Promise<void> {
  const { organizationId, campaignId, sourceId } = payload;

  const sourceRows = await db
    .select()
    .from(campaignSources)
    .where(
      and(
        eq(campaignSources.id, sourceId),
        eq(campaignSources.organizationId, organizationId),
      ),
    )
    .limit(1);

  const source = sourceRows[0];
  if (!source) {
    throw new Error(`campaign_source ${sourceId} nao encontrado`);
  }

  const [job] = await db
    .insert(scrapingJobs)
    .values({
      organizationId,
      campaignId,
      sourceType: source.type,
      input: source.config,
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: scrapingJobs.id });

  if (!job) {
    throw new Error("falha ao criar scraping_job");
  }

  try {
    let leads: NormalizedLead[] = [];
    let sourceTypeForIngest: ScrapeIngestPayload["sourceType"] = "google_places";

    if (source.type === "google_places") {
      if (!isGooglePlacesConfig(source.config)) {
        throw new Error("config invalida para google_places");
      }
      const cred = await getOrgCredential(organizationId, "google_places");
      const places = await searchPlaces({
        query: source.config.query,
        location: source.config.location,
        radius: source.config.radius,
        maxResults: source.config.maxResults ?? 60,
        apiKey: cred.apiKey,
      });
      leads = places.map((p) => ({
        source: "google_places",
        externalId: p.placeId,
        displayName: p.name,
        handle: null,
        website: p.website,
        phone: p.phone,
        email: null,
        city: p.city,
        region: p.state,
        country: p.country,
        rawData: p as unknown as Record<string, unknown>,
      }));
      sourceTypeForIngest = "google_places";
    } else if (
      source.type === "instagram_hashtag" ||
      source.type === "instagram_profile"
    ) {
      if (!isApifyInstagramConfig(source.config)) {
        throw new Error("config invalida para apify_instagram");
      }
      const cred = await getOrgCredential(organizationId, "apify");
      const profiles = await searchInstagramAndScrape({
        token: cred.token,
        search: source.config.search,
        maxResults: source.config.maxResults ?? 30,
      });
      leads = profiles.map((p: IgLead) => ({
        source: "instagram",
        externalId: p.username,
        displayName: p.fullName ?? p.username,
        handle: p.username,
        website: p.externalUrl,
        phone: null,
        email: null,
        city: null,
        region: null,
        country: null,
        rawData: p as unknown as Record<string, unknown>,
      }));
      sourceTypeForIngest = "apify_instagram";
    } else if (source.type === "linkedin_search") {
      if (!isLinkedInSearchConfig(source.config)) {
        throw new Error("config invalida para linkedin_search");
      }
      const cred = await getOrgCredential(organizationId, "apify");
      const profiles = await searchLinkedInProfiles({
        token: cred.token,
        query: source.config.query,
        maxResults: source.config.maxResults ?? 50,
      });
      leads = profiles.map((p: LinkedInProfile) => ({
        source: "linkedin",
        externalId: p.publicIdentifier,
        displayName: p.fullName ?? p.publicIdentifier,
        handle: p.publicIdentifier,
        website: null,
        phone: null,
        email: null,
        city: p.location,
        region: null,
        country: null,
        linkedinUrl: p.linkedinUrl,
        headline: p.headline,
        company: p.company,
        rawData: p as unknown as Record<string, unknown>,
      }));
      sourceTypeForIngest = "linkedin_search";
    } else {
      throw new Error(`source type ${source.type} nao suportado`);
    }

    await db
      .update(scrapingJobs)
      .set({
        leadsFound: leads.length,
        status: "completed",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scrapingJobs.id, job.id));

    await db
      .update(campaignSources)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(campaignSources.id, sourceId));

    if (leads.length > 0) {
      const boss = await getBoss();
      const ingestPayload: ScrapeIngestPayload = {
        organizationId,
        campaignId,
        sourceType: sourceTypeForIngest,
        scrapingJobId: job.id,
        leads,
      };
      await boss.send(QUEUES.scrapeIngest, ingestPayload);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(scrapingJobs)
      .set({
        status: "failed",
        error: message,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scrapingJobs.id, job.id));
    throw err;
  }
}
