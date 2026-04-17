import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL nao definida");
}

const globalForPg = globalThis as unknown as {
  pgNode?: ReturnType<typeof postgres>;
};

export const pg =
  globalForPg.pgNode ??
  postgres(connectionString, {
    max: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgNode = pg;
}

export const db = drizzle(pg, { schema });
export type Database = typeof db;
