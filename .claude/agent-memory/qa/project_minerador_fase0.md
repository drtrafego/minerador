---
name: Minerador Claude — Fase 0 revisada
description: Resultado do code review completo da Fase 0 (fundação Next.js 15/16 + Drizzle + Better Auth multi-tenant + pgcrypto + Docker)
type: project
---

Code review da Fase 0 concluído em 2026-04-12.

**Why:** Fase 0 é a fundação do app de prospecção ativa (Maps + Instagram scraping). Bugs aqui propagam para todas as fases seguintes.

**How to apply:** Antes de avançar para Fase 1, o @dev deve corrigir os itens HIGH marcados no relatório, especialmente os três schema bugs do Better Auth (organization.slug nullable, organization.updatedAt ausente, invitation sem createdAt/role notNull).

## Bugs identificados por severidade

### HIGH (3 itens — schema Better Auth incompatível)
1. `src/db/schema/auth.ts:57` — `organization.slug` é nullable no Drizzle mas `required: true` na lib
2. `src/db/schema/auth.ts:54-61` — tabela `organization` sem campo `updatedAt`
3. `src/db/schema/auth.ts:75-87` — tabela `invitation` sem `createdAt` e `role` nullable (lib espera notNull)

### MEDIUM (3 itens)
4. `src/lib/db/tenant.ts` — helper expõe `raw: db` sem proteção, dev pode bypassar filtro de org
5. `src/db/schema/jobs.ts:99-105` — unique index de `sendCounters` inclui `campaignId` nullable (NULL != NULL no Postgres)
6. `src/db/schema/jobs.ts:70` — `costUsd` como `text` em vez de `numeric`

### LOW (2 itens)
7. `docker-compose.dev.yml:14` — porta 5432 sem bind alternativo, conflita com Postgres local
8. `PGBOSS_SCHEMA` declarada no .env.example e docker-compose mas não consumida em nenhum arquivo src/
