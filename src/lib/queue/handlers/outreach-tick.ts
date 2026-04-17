import { sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { outreachQueue } from "@/db/schema/outreach";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { OutreachSendPayload } from "@/lib/queue/types";

export async function handleOutreachTick(): Promise<void> {
  const rows = await db
    .select({ id: outreachQueue.id })
    .from(outreachQueue)
    .where(
      sql`${outreachQueue.status} = 'pending'
        AND ${outreachQueue.scheduledAt} <= now()
        AND (${outreachQueue.lockedUntil} IS NULL OR ${outreachQueue.lockedUntil} < now())`,
    )
    .limit(500);

  if (rows.length === 0) return;

  const boss = await getBoss();
  for (const row of rows) {
    const payload: OutreachSendPayload = { queueItemId: row.id };
    await boss.send(QUEUES.outreachSend, payload);
  }

  console.log(`[outreach.tick] re-emitidos ${rows.length} itens`);
}
