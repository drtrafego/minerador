export type PlaceLead = {
  placeId: string;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  types: string[];
  location: { lat: number; lng: number } | null;
  raw: Record<string, unknown>;
};

type TextSearchResponse = {
  results: Array<{
    place_id: string;
    name: string;
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
  }>;
  next_page_token?: string;
  status: string;
  error_message?: string;
};

type DetailsResponse = {
  result: {
    place_id: string;
    name: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    international_phone_number?: string;
    website?: string;
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
    geometry?: { location?: { lat: number; lng: number } };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  };
  status: string;
  error_message?: string;
};

const TEXT_SEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

const DETAILS_FIELDS = [
  "place_id",
  "name",
  "formatted_address",
  "formatted_phone_number",
  "international_phone_number",
  "website",
  "rating",
  "user_ratings_total",
  "types",
  "geometry",
  "address_components",
].join(",");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickComponent(
  components: DetailsResponse["result"]["address_components"],
  type: string,
): string | null {
  if (!components) return null;
  const found = components.find((c) => c.types.includes(type));
  return found?.long_name ?? null;
}

async function fetchDetails(
  placeId: string,
  apiKey: string,
): Promise<DetailsResponse["result"] | null> {
  const url = new URL(DETAILS_URL);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", DETAILS_FIELDS);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`google places details http ${res.status}`);
  }
  const data = (await res.json()) as DetailsResponse;
  if (data.status !== "OK") {
    if (data.status === "ZERO_RESULTS" || data.status === "NOT_FOUND") {
      return null;
    }
    throw new Error(
      `google places details status ${data.status}: ${data.error_message ?? ""}`,
    );
  }
  return data.result;
}

export async function searchPlaces(opts: {
  query: string;
  location?: string;
  radius?: number;
  maxResults?: number;
  apiKey: string;
}): Promise<PlaceLead[]> {
  const { query, location, radius, maxResults = 60, apiKey } = opts;

  const results: TextSearchResponse["results"] = [];
  let nextPageToken: string | undefined;
  const fullQuery = location ? `${query} em ${location}` : query;

  do {
    const url = new URL(TEXT_SEARCH_URL);
    if (nextPageToken) {
      url.searchParams.set("pagetoken", nextPageToken);
      url.searchParams.set("key", apiKey);
      await delay(2000);
    } else {
      url.searchParams.set("query", fullQuery);
      if (radius) url.searchParams.set("radius", String(radius));
      url.searchParams.set("key", apiKey);
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`google places http ${res.status}`);
    }
    const data = (await res.json()) as TextSearchResponse;
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(
        `google places status ${data.status}: ${data.error_message ?? ""}`,
      );
    }

    results.push(...data.results);
    nextPageToken = data.next_page_token;
    if (results.length >= maxResults) break;
  } while (nextPageToken);

  const limited = results.slice(0, maxResults);

  const detailed: PlaceLead[] = [];
  for (const r of limited) {
    let details: DetailsResponse["result"] | null = null;
    try {
      details = await fetchDetails(r.place_id, apiKey);
    } catch {
      details = null;
    }

    const components = details?.address_components;
    detailed.push({
      placeId: r.place_id,
      name: details?.name ?? r.name,
      phone:
        details?.international_phone_number ??
        details?.formatted_phone_number ??
        null,
      website: details?.website ?? null,
      address: details?.formatted_address ?? r.formatted_address ?? null,
      city:
        pickComponent(components, "administrative_area_level_2") ??
        pickComponent(components, "locality") ??
        null,
      state: pickComponent(components, "administrative_area_level_1"),
      country: pickComponent(components, "country"),
      rating: details?.rating ?? r.rating ?? null,
      userRatingsTotal:
        details?.user_ratings_total ?? r.user_ratings_total ?? null,
      types: details?.types ?? r.types ?? [],
      location:
        details?.geometry?.location ?? r.geometry?.location ?? null,
      raw: { search: r, details: details ?? null },
    });
  }

  return detailed;
}
