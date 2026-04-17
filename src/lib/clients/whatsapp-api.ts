import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import { decryptCredential, encryptCredential } from "@/lib/crypto/credentials";
import { eq, and, desc } from "drizzle-orm";

export type WhatsAppAPICredential = {
  phone_number_id: string;
  access_token: string;
  verify_token: string;
};

export class WhatsAppAPINotConfiguredError extends Error {
  constructor() {
    super("whatsapp_api credential nao configurada");
    this.name = "WhatsAppAPINotConfiguredError";
  }
}

export class WhatsAppAPIError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "WhatsAppAPIError";
    this.statusCode = statusCode;
  }
}

export async function loadWhatsAppAPICredential(
  organizationId: string,
): Promise<{ id: string; cred: WhatsAppAPICredential } | null> {
  const row = await db.query.credentials.findFirst({
    where: and(
      eq(credentials.organizationId, organizationId),
      eq(credentials.provider, "whatsapp_api"),
    ),
    orderBy: desc(credentials.createdAt),
  });
  if (!row) return null;
  try {
    const cred = await decryptCredential<WhatsAppAPICredential>(row.ciphertext);
    return { id: row.id, cred };
  } catch {
    return null;
  }
}

export async function saveWhatsAppAPICredential(
  organizationId: string,
  cred: WhatsAppAPICredential,
): Promise<string> {
  const ciphertext = await encryptCredential(cred);
  const existing = await loadWhatsAppAPICredential(organizationId);
  if (existing) {
    await db
      .update(credentials)
      .set({ ciphertext, updatedAt: new Date() })
      .where(eq(credentials.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(credentials)
    .values({
      organizationId,
      provider: "whatsapp_api",
      label: `WhatsApp API ${cred.phone_number_id}`,
      ciphertext,
    })
    .returning({ id: credentials.id });
  return row.id;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function sendWhatsAppAPIMessage(params: {
  organizationId: string;
  phone: string;
  body: string;
}): Promise<{ messageId: string }> {
  const result = await loadWhatsAppAPICredential(params.organizationId);
  if (!result) throw new WhatsAppAPINotConfiguredError();

  const { phone_number_id, access_token } = result.cred;
  const to = normalizePhone(params.phone);

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: params.body },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new WhatsAppAPIError(
      `Meta API erro ${res.status}: ${text}`,
      res.status,
    );
  }

  const json = (await res.json()) as { messages: { id: string }[] };
  return { messageId: json.messages[0].id };
}
