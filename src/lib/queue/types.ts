export type ScrapeRunPayload = {
  campaignId: string;
  organizationId: string;
  sourceId: string;
};

export type NormalizedLead = {
  source: "google_places" | "instagram" | "manual" | "import" | "linkedin";
  externalId: string;
  displayName: string;
  handle?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  headline?: string | null;
  company?: string | null;
  rawData: Record<string, unknown>;
};

export type ScrapeIngestPayload = {
  organizationId: string;
  campaignId: string;
  sourceType: "google_places" | "apify_instagram" | "linkedin_search";
  scrapingJobId: string;
  leads: NormalizedLead[];
};

export type QualifyBatchPayload = {
  organizationId: string;
  campaignId: string;
  batchSize?: number;
};

export type OutreachEnqueuePayload = {
  organizationId: string;
  leadId: string;
  campaignId: string;
};

export type OutreachSendPayload = {
  queueItemId: string;
};

export type OutreachTickPayload = Record<string, never>;

export type AgentReplyPayload = {
  organizationId: string;
  threadId: string;
  inboundMessageId: string;
};
