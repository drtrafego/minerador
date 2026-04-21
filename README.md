# Minerador Claude

App de prospeccao ativa para DR.TRAFEGO. Minera leads em **Google Maps, LinkedIn e Instagram** via Scrapling stealth (Python FastAPI), qualifica com Claude, envia DMs via Playwright, emails via Gmail API, WhatsApp via UazAPI/Meta/Baileys e faz follow up automatico. Responde leads inbound com agente Claude. Multi tenant desde o dia 1.

## Stack

- Next.js 16 (App Router, Server Components, Server Actions)
- TypeScript strict
- Tailwind CSS v4 + shadcn/ui (tema dark)
- Drizzle ORM + PostgreSQL 16 (Docker)
- Better Auth + plugin organization (multi tenant)
- pg-boss para filas (Postgres)
- pgcrypto para criptografia de credentials
- **Scrapling** (Python FastAPI) para scraping stealth
- **@dnd-kit** para Kanban drag-and-drop
- pnpm

## Features

### Mineracao
- **Google Maps**: Scrapling (Playwright + scroll no feed)
- **LinkedIn**: Scrapling via Google dork (`site:linkedin.com/in`)
- **Instagram**: Scrapling (StealthyFetcher + endpoint publico)
- **Import CSV**: `/leads/import` com wizard de mapeamento
- **Webhook formularios**: `/api/webhooks/forms` para Typeform/Tally/Google Forms/Zapier

### Qualificacao
- Claude com tool use (decision + score + reason)
- Temperature automatica: `>= 70 = hot`, `40-69 = warm`, `< 40 = cold`
- Multi modelo configuravel por campanha

### Pipeline
- `/pipeline` com Kanban drag-and-drop
- Etapas customizaveis por organizacao
- Timeline de atividades por lead (`/leads/[id]`)

### Outreach
- **Email**: Gmail API
- **Instagram DM / LinkedIn DM**: Playwright
- **WhatsApp**: 3 providers (Meta Cloud API, UazAPI self-hosted, Baileys QR)
- Follow up sequence com IA opcional (smartFollowUp)

### Inbound Agent
- Responde WhatsApp automaticamente usando Claude
- Suporta UazAPI e Meta Cloud API (selecionavel)
- System prompt customizavel em `/settings/agent`
- Handoff keywords param o agente
- Limite de respostas automaticas por thread

### Export
- `/api/leads/export` retorna CSV com filtros (status, campanha)

## Rodar em desenvolvimento

Pre requisitos: Node 20+, pnpm, Docker Desktop.

```bash
cp .env.example .env.local
# preencha BETTER_AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY,
# SCRAPLING_SHARED_SECRET, FORMS_WEBHOOK_SECRET, ANTHROPIC_API_KEY
# gere secrets com: openssl rand -hex 32

docker compose -f docker-compose.dev.yml up -d   # so Postgres
pnpm install
pnpm db:push                                     # aplica schema
pnpm dev
```

Em terminais separados:
```bash
pnpm worker                                      # filas pg-boss
```

Scrapling roda no stack prod (docker compose up scrapling). Em dev,
desabilite com `SCRAPLING_ENABLED=false` ou suba o container avulso.

Acesse http://localhost:3000, crie conta, crie organizacao e va em
`/settings/credentials` para cadastrar credentials.

## Rodar em producao

```bash
cp .env.example .env
# preencha todos os secrets

docker compose up -d --build
pnpm db:migrate                                  # uma vez
```

Sobe: `postgres`, `app`, `worker`, `scrapling`.

## Primeira campanha

1. Cadastre credentials em `/settings/credentials` (payload JSON):
   - `anthropic` -> `{"apiKey":"sk-ant-..."}`
   - WhatsApp (opcional): `whatsapp_api` / `whatsapp_uazapi` / `whatsapp_qr`
2. Em `/campaigns` -> "Nova campanha"
3. Escolha fonte: Google Maps / Instagram / LinkedIn
4. Ajuste prompt de qualificacao
5. Adicione sequencia de follow up
6. Criar e comecar. Acompanhe em `/campaigns/[id]`

## Estrutura

```
src/
  app/
    (auth)/              sign-in, sign-up, onboarding
    (app)/
      dashboard/
      campaigns/         CRUD + wizard
      leads/             listagem, detalhe, import
      pipeline/          Kanban drag-and-drop
      inbox/             conversas outreach
      settings/
        credentials/     API keys e sessoes
        agent/           config do inbound agent
    api/
      auth/              Better Auth
      leads/export/      CSV export
      webhooks/
        whatsapp/        Meta Cloud + UazAPI
        forms/           Typeform/Tally/Google Forms
  components/
    ui/                  shadcn/ui
    pipeline/            kanban-board, activity-timeline
    temperature-badge
  db/schema/             auth, credentials, campaigns, leads,
                         outreach, jobs, events, pipeline, agent
  lib/
    auth/                server, client, guards
    clients/             anthropic, google-places, apify,
                         scrapling, gmail, whatsapp-*,
                         playwright-instagram, playwright-linkedin
    queue/
      client, types
      handlers/          scrape, ingest, qualify,
                         outreach-enqueue, outreach-send,
                         outreach-tick, agent-reply
    outreach/            template, rate-limit, smart-followup-prompt
    csv.ts               parse/serialize
    crypto/              credentials (pgcrypto)
scrapling/               microservico Python FastAPI
  app/
    main.py
    config, auth, schemas, errors
    routers/             health, linkedin, google_maps, instagram
    scrapers/            linkedin_search, google_maps_search,
                         instagram_search
  Dockerfile
  requirements.txt
  README.md
docker/postgres/init/    scripts SQL
drizzle/                 migrations
docs/                    documentacao especifica por feature
docker-compose.yml       stack completa (postgres + app + worker + scrapling)
docker-compose.dev.yml   so Postgres (dev)
```

## Scripts

- `pnpm dev` - Next em dev
- `pnpm build` - build producao
- `pnpm typecheck` - TypeScript
- `pnpm lint` - ESLint
- `pnpm worker` - processar filas
- `pnpm db:generate` - gerar migration
- `pnpm db:push` - aplicar schema (dev)
- `pnpm db:migrate` - aplicar migrations (prod)
- `pnpm db:studio` - Drizzle Studio

## Documentacao

- [Variaveis de ambiente](docs/env-vars.md)
- [Scrapling microservico](docs/scrapling.md) ([README do servico](scrapling/README.md))
- [Pipeline, temperature e atividades](docs/pipeline.md)
- [CSV e webhook de formularios](docs/csv-webhook.md)
- [Inbound agent WhatsApp](docs/agent.md)
- [Webhooks WhatsApp (Meta + UazAPI)](docs/whatsapp.md)

## Roadmap

- **Fase 0**: fundacao, auth multi tenant, credentials criptografadas - `feito`
- **Fase 1**: scraping (Scrapling + Apify + Places), qualificacao Claude, inbox - `feito`
- **Fase 2**: outreach Instagram/LinkedIn/Email/WhatsApp, follow ups, smart AI - `feito`
- **Fase 3**: Kanban pipeline, lead temperature, activity timeline - `feito`
- **Fase 4**: CSV import/export, webhook formularios, inbound agent WhatsApp - `feito`
- **Fase 5**: Observabilidade (tracing, metricas), deploy VPS, rate limit global
- **SaaS**: billing Stripe, onboarding, quotas por plano
