"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { encryptCredential } from "@/lib/crypto/credentials";
import { requireOrg } from "@/lib/auth/guards";

const providerEnum = z.enum([
  "anthropic",
  "apify",
  "google_oauth",
  "google_places",
  "instagram_session",
  "whatsapp_api",
]);

const createSchema = z.object({
  provider: providerEnum,
  label: z.string().min(1).max(100),
  payload: z.string().min(1),
});

export async function createCredential(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = createSchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    payload: formData.get("payload"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  let payloadObj: Record<string, unknown>;
  try {
    payloadObj = JSON.parse(parsed.data.payload);
    if (typeof payloadObj !== "object" || payloadObj === null || Array.isArray(payloadObj)) {
      return { error: { payload: ["JSON deve ser um objeto"] } };
    }
  } catch {
    return { error: { payload: ["JSON invalido"] } };
  }

  const ciphertext = await encryptCredential(payloadObj);

  await db.insert(credentials).values({
    organizationId,
    provider: parsed.data.provider,
    label: parsed.data.label,
    ciphertext,
  });

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function deleteCredential(formData: FormData) {
  const { organizationId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "id obrigatorio" };

  await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.organizationId, organizationId)));

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function disconnectGmail() {
  const { organizationId } = await requireOrg();
  await db
    .delete(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "google_oauth"),
      ),
    );
  revalidatePath("/settings/credentials");
  return { ok: true };
}
