import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { outreachThreads, outreachMessages } from "@/db/schema/outreach";
import { decryptCredential } from "@/lib/crypto/credentials";
import { eq, and } from "drizzle-orm";
import type { WhatsAppAPICredential } from "@/lib/clients/whatsapp-api";

// GET: verificação do webhook pelo Meta
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return Response.json({ error: "forbidden" }, { status: 403 });
}

// POST: mensagens inbound
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      entry?: {
        changes?: {
          value?: {
            phone_number_id?: string;
            messages?: { id: string; from: string; text?: { body: string }; type: string }[];
          };
        }[];
      }[];
    };

    const value = body.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.length) {
      return Response.json({ ok: true }, { status: 200 });
    }

    const phoneNumberId = value.phone_number_id;
    const msg = value.messages[0];
    if (!msg || msg.type !== "text" || !msg.text?.body) {
      return Response.json({ ok: true }, { status: 200 });
    }

    // Encontrar qual org tem esse phone_number_id
    const allApiCreds = await db.query.credentials.findMany({
      where: eq(credentials.provider, "whatsapp_api"),
    });

    let organizationId: string | null = null;
    for (const row of allApiCreds) {
      try {
        const cred = await decryptCredential<WhatsAppAPICredential>(row.ciphertext);
        if (cred.phone_number_id === phoneNumberId) {
          organizationId = row.organizationId;
          break;
        }
      } catch {}
    }

    if (!organizationId) {
      return Response.json({ ok: true }, { status: 200 });
    }

    // Encontrar thread pelo externalThreadId (número do remetente)
    const thread = await db.query.outreachThreads.findFirst({
      where: and(
        eq(outreachThreads.organizationId, organizationId),
        eq(outreachThreads.externalThreadId, msg.from),
      ),
    });

    if (thread) {
      await db.insert(outreachMessages).values({
        organizationId,
        threadId: thread.id,
        direction: "inbound",
        status: "received",
        step: thread.currentStep,
        body: msg.text.body,
        externalMessageId: msg.id,
      });

      if (thread.status === "active" || thread.status === "awaiting_reply") {
        await db
          .update(outreachThreads)
          .set({
            status: "replied",
            lastInboundAt: new Date(),
            lastMessageAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(outreachThreads.id, thread.id));
      }
    }
  } catch (err) {
    console.error("[webhook/whatsapp] erro:", err);
  }

  // Meta exige 200 sempre
  return Response.json({ ok: true }, { status: 200 });
}
