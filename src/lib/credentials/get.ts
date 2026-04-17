import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import { decryptCredential } from "@/lib/crypto/credentials";

export class MissingCredentialError extends Error {
  constructor(provider: string) {
    super(`Credential ${provider} nao configurada para esta org`);
    this.name = "MissingCredentialError";
  }
}

type ProviderPayloads = {
  google_places: { apiKey: string };
  apify: { token: string };
  anthropic: { apiKey: string };
  google_oauth: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
  };
  instagram_session: { cookies: unknown };
  proxycurl: { apiKey: string };
};

export async function getOrgCredential<P extends keyof ProviderPayloads>(
  organizationId: string,
  provider: P,
): Promise<ProviderPayloads[P]> {
  const rows = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, provider),
      ),
    )
    .orderBy(desc(credentials.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new MissingCredentialError(provider);
  }

  const payload = await decryptCredential<ProviderPayloads[P]>(row.ciphertext);
  return payload;
}
