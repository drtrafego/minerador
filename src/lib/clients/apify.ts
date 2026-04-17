import { ApifyClient } from "apify-client";

export type IgLead = {
  username: string;
  fullName: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  category: string | null;
  externalUrl: string | null;
  isBusinessAccount: boolean | null;
  profilePicUrl: string | null;
  raw: Record<string, unknown>;
};

const POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const PROFILE_SCRAPER_ACTOR = "apify/instagram-profile-scraper";
const SEARCH_SCRAPER_ACTOR = "apify/instagram-search-scraper";

function getClient(token: string): ApifyClient {
  return new ApifyClient({ token });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runActor(opts: {
  token: string;
  actorId: string;
  input: Record<string, unknown>;
}): Promise<{ runId: string; defaultDatasetId: string }> {
  const client = getClient(opts.token);
  const run = await client.actor(opts.actorId).start(opts.input);
  return { runId: run.id, defaultDatasetId: run.defaultDatasetId };
}

export async function waitForRun(opts: {
  token: string;
  runId: string;
  timeoutMs?: number;
}): Promise<{ status: string; defaultDatasetId: string }> {
  const client = getClient(opts.token);
  const start = Date.now();
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  while (true) {
    const run = await client.run(opts.runId).get();
    if (!run) {
      throw new Error(`apify run ${opts.runId} nao encontrado`);
    }
    if (run.status === "SUCCEEDED") {
      return { status: run.status, defaultDatasetId: run.defaultDatasetId };
    }
    if (
      run.status === "FAILED" ||
      run.status === "ABORTED" ||
      run.status === "TIMED-OUT"
    ) {
      throw new Error(`apify run ${opts.runId} terminou com status ${run.status}`);
    }
    if (Date.now() - start > timeout) {
      throw new Error(`apify run ${opts.runId} timeout apos ${timeout}ms`);
    }
    await delay(POLL_INTERVAL_MS);
  }
}

export async function getDataset<T = Record<string, unknown>>(opts: {
  token: string;
  datasetId: string;
}): Promise<T[]> {
  const client = getClient(opts.token);
  const { items } = await client.dataset(opts.datasetId).listItems();
  return items as unknown as T[];
}

type RawIgProfile = {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  businessCategoryName?: string;
  externalUrl?: string;
  isBusinessAccount?: boolean;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
  id?: string;
  [key: string]: unknown;
};

function normalizeProfile(item: RawIgProfile): IgLead | null {
  const username =
    typeof item.username === "string" ? item.username.trim() : null;
  if (!username) return null;
  return {
    username,
    fullName: typeof item.fullName === "string" ? item.fullName : null,
    bio: typeof item.biography === "string" ? item.biography : null,
    followers:
      typeof item.followersCount === "number" ? item.followersCount : null,
    following:
      typeof item.followsCount === "number" ? item.followsCount : null,
    postsCount: typeof item.postsCount === "number" ? item.postsCount : null,
    category:
      typeof item.businessCategoryName === "string"
        ? item.businessCategoryName
        : null,
    externalUrl:
      typeof item.externalUrl === "string" ? item.externalUrl : null,
    isBusinessAccount:
      typeof item.isBusinessAccount === "boolean"
        ? item.isBusinessAccount
        : null,
    profilePicUrl:
      typeof item.profilePicUrlHD === "string"
        ? item.profilePicUrlHD
        : typeof item.profilePicUrl === "string"
          ? item.profilePicUrl
          : null,
    raw: item as Record<string, unknown>,
  };
}

export async function scrapeInstagramProfiles(opts: {
  token: string;
  usernames: string[];
}): Promise<IgLead[]> {
  if (opts.usernames.length === 0) return [];
  const { runId } = await runActor({
    token: opts.token,
    actorId: PROFILE_SCRAPER_ACTOR,
    input: { usernames: opts.usernames },
  });
  const { defaultDatasetId } = await waitForRun({
    token: opts.token,
    runId,
  });
  const items = await getDataset<RawIgProfile>({
    token: opts.token,
    datasetId: defaultDatasetId,
  });
  return items
    .map((item) => normalizeProfile(item))
    .filter((lead): lead is IgLead => lead !== null);
}

type SearchHit = {
  username?: string;
  url?: string;
  [key: string]: unknown;
};

function extractUsernameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    return seg ?? null;
  } catch {
    return null;
  }
}

export async function searchInstagramAndScrape(opts: {
  token: string;
  search: string;
  maxResults: number;
}): Promise<IgLead[]> {
  const { runId: searchRunId } = await runActor({
    token: opts.token,
    actorId: SEARCH_SCRAPER_ACTOR,
    input: {
      search: opts.search,
      searchType: "user",
      searchLimit: opts.maxResults,
    },
  });
  const { defaultDatasetId: searchDataset } = await waitForRun({
    token: opts.token,
    runId: searchRunId,
  });
  const hits = await getDataset<SearchHit>({
    token: opts.token,
    datasetId: searchDataset,
  });

  const usernames = new Set<string>();
  for (const hit of hits) {
    if (typeof hit.username === "string" && hit.username.trim()) {
      usernames.add(hit.username.trim());
      continue;
    }
    if (typeof hit.url === "string") {
      const u = extractUsernameFromUrl(hit.url);
      if (u) usernames.add(u);
    }
  }

  const list = Array.from(usernames).slice(0, opts.maxResults);
  if (list.length === 0) return [];

  return scrapeInstagramProfiles({ token: opts.token, usernames: list });
}



export type LinkedInProfile = {
  publicIdentifier: string;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  company: string | null;
  linkedinUrl: string | null;
};

// TODO: substituir por Scrapling quando worker Python estiver disponível
export async function searchLinkedInProfiles(_opts: {
  token: string;
  query: string;
  maxResults: number;
}): Promise<LinkedInProfile[]> {
  return [];
}
