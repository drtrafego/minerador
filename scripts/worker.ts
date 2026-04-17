import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(resolve(process.cwd(), ".env.local"))) {
  loadEnv({ path: ".env.local" });
} else {
  loadEnv();
}

import type { Job } from "pg-boss";
import { getBoss, QUEUES } from "@/lib/queue/client";
import { handleScrapeRun } from "@/lib/queue/handlers/scrape";
import { handleScrapeIngest } from "@/lib/queue/handlers/ingest";
import { handleQualifyBatch } from "@/lib/queue/handlers/qualify";
import { handleOutreachEnqueue } from "@/lib/queue/handlers/outreach-enqueue";
import { handleOutreachSend } from "@/lib/queue/handlers/outreach-send";
import { handleOutreachTick } from "@/lib/queue/handlers/outreach-tick";
import type {
  QualifyBatchPayload,
  ScrapeIngestPayload,
  ScrapeRunPayload,
  OutreachEnqueuePayload,
  OutreachSendPayload,
  OutreachTickPayload,
} from "@/lib/queue/types";

async function main() {
  const boss = await getBoss();

  boss.on("error", (err: Error) => {
    console.error("[pg-boss] error", err);
  });

  const queuePolicy = {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
  };

  await boss.createQueue(QUEUES.scrapeRun, queuePolicy);
  await boss.createQueue(QUEUES.scrapeIngest, queuePolicy);
  await boss.createQueue(QUEUES.qualifyBatch, queuePolicy);
  await boss.createQueue(QUEUES.outreachEnqueue, queuePolicy);
  await boss.createQueue(QUEUES.outreachSend, queuePolicy);
  await boss.createQueue(QUEUES.outreachTick, queuePolicy);

  await boss.work<ScrapeRunPayload>(
    QUEUES.scrapeRun,
    { batchSize: 1 },
    async (jobs: Job<ScrapeRunPayload>[]) => {
      for (const job of jobs) {
        console.log(`[scrape.run] processando ${job.id}`);
        try {
          await handleScrapeRun(job.data);
          console.log(`[scrape.run] ok ${job.id}`);
        } catch (err) {
          console.error(`[scrape.run] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<ScrapeIngestPayload>(
    QUEUES.scrapeIngest,
    { batchSize: 1 },
    async (jobs: Job<ScrapeIngestPayload>[]) => {
      for (const job of jobs) {
        console.log(`[scrape.ingest] processando ${job.id}`);
        try {
          await handleScrapeIngest(job.data);
          console.log(`[scrape.ingest] ok ${job.id}`);
        } catch (err) {
          console.error(`[scrape.ingest] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<QualifyBatchPayload>(
    QUEUES.qualifyBatch,
    { batchSize: 1 },
    async (jobs: Job<QualifyBatchPayload>[]) => {
      for (const job of jobs) {
        console.log(`[qualify.batch] processando ${job.id}`);
        try {
          await handleQualifyBatch(job.data);
          console.log(`[qualify.batch] ok ${job.id}`);
        } catch (err) {
          console.error(`[qualify.batch] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<OutreachEnqueuePayload>(
    QUEUES.outreachEnqueue,
    { batchSize: 5 },
    async (jobs: Job<OutreachEnqueuePayload>[]) => {
      for (const job of jobs) {
        console.log(`[outreach.enqueue] processando ${job.id}`);
        try {
          await handleOutreachEnqueue(job.data);
          console.log(`[outreach.enqueue] ok ${job.id}`);
        } catch (err) {
          console.error(`[outreach.enqueue] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<OutreachSendPayload>(
    QUEUES.outreachSend,
    { batchSize: 3 },
    async (jobs: Job<OutreachSendPayload>[]) => {
      for (const job of jobs) {
        console.log(`[outreach.send] processando ${job.id}`);
        try {
          await handleOutreachSend(job.data);
          console.log(`[outreach.send] ok ${job.id}`);
        } catch (err) {
          console.error(`[outreach.send] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<OutreachTickPayload>(
    QUEUES.outreachTick,
    { batchSize: 1 },
    async (jobs: Job<OutreachTickPayload>[]) => {
      for (const job of jobs) {
        try {
          await handleOutreachTick();
        } catch (err) {
          console.error(`[outreach.tick] erro ${job.id}`, err);
          throw err;
        }
      }
    },
  );

  try {
    await boss.schedule(QUEUES.outreachTick, "*/2 * * * *");
  } catch (err) {
    console.error("[worker] falha ao registrar cron outreach.tick", err);
  }

  console.log("[worker] pronto, aguardando jobs");

  const shutdown = async () => {
    console.log("[worker] desligando");
    try {
      await boss.stop({ graceful: true, close: true });
    } catch (err) {
      console.error("[worker] erro ao desligar", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] falha fatal", err);
  process.exit(1);
});
