# Minerador Claude

App de prospeccao ativa para DR.TRAFEGO. Rastreia leads em Google Maps (Places API) e Instagram (Apify), qualifica com Claude, envia DMs via Playwright e emails via Gmail API, e faz follow up automatico. Multi tenant desde o dia 1. Uso interno mas preparado para virar SaaS.

## Stack

- Next.js 16 (App Router, Server Components, Server Actions)
- TypeScript strict
- Tailwind CSS v4 + shadcn/ui (tema dark)
- Drizzle ORM + PostgreSQL 16 (Docker)
- Better Auth + plugin organization (multi tenant)
- pg-boss para filas (Postgres)
- pgcrypto para criptografia de credentials
- pnpm

## Rodar em desenvolvimento

Pre requisitos: Node 20+, pnpm, Docker Desktop.

```bash
cp .env.example .env.local
# edite .env.local com BETTER_AUTH_SECRET e CREDENTIALS_ENCRYPTION_KEY

docker compose -f docker-compose.dev.yml up -d
pnpm install
pnpm db:push
pnpm dev
```

Em outro terminal rode o worker das filas:

```bash
pnpm worker
```

Acesse http://localhost:3000, crie conta, crie organizacao e va em Settings para cadastrar credentials (anthropic, apify, google_places).

## Como rodar o worker

O worker e um processo Node separado que escuta filas pg-boss e executa scraping/qualificacao. Sem ele, campanhas iniciadas ficam paradas.

- Dev: `pnpm worker` em terminal separado
- Producao Docker: o servico `worker` sobe junto com `docker compose up -d --build`

## Como criar a primeira campanha

1. Cadastre as 3 credentials em /settings/credentials, todas como objeto JSON:
   - provider `google_places`, payload `{"apiKey":"AIza..."}`
   - provider `apify`, payload `{"token":"apify_api_..."}`
   - provider `anthropic`, payload `{"apiKey":"sk-ant-..."}`
2. Va em /campaigns e clique em "Nova campanha".
3. Passo 1: nome, nicho e fonte (Google Maps ou Instagram).
4. Passo 2: parametros da fonte (query, cidade, raio para Maps; busca para Instagram).
5. Passo 3: ajuste o prompt de qualificacao (template ja preenchido).
6. Clique em "Criar e comecar". O sistema enfileira o scraping e voce pode acompanhar em /campaigns/[id].
7. Quando os leads forem ingeridos, o worker chama Claude em batches e os leads aparecem qualificados em /campaigns/[id]/leads.

## Rodar em producao

```bash
cp .env.example .env
# edite .env com valores de producao

docker compose up -d --build
```

O `docker-compose.yml` sobe Postgres + app Next.js buildado. As migrations devem ser aplicadas uma vez via `pnpm db:migrate` contra o container de Postgres.

## Variaveis de ambiente

| Variavel | Obrigatorio | Descricao |
|----------|-------------|-----------|
| `DATABASE_URL` | sim | Conexao Postgres |
| `BETTER_AUTH_SECRET` | sim | Secret do Better Auth (32+ chars) |
| `BETTER_AUTH_URL` | sim | URL base do app |
| `APP_URL` | sim | URL publica do app |
| `NEXT_PUBLIC_APP_URL` | sim | URL publica para o client |
| `CREDENTIALS_ENCRYPTION_KEY` | sim | Chave de criptografia pgcrypto |
| `ANTHROPIC_API_KEY` | Fase 1 | Claude API |
| `APIFY_TOKEN` | Fase 1 | Scraping Instagram |
| `GOOGLE_PLACES_API_KEY` | Fase 1 | Google Maps |
| `GOOGLE_OAUTH_*` | Fase 2 | Gmail API |
| `PGBOSS_SCHEMA` | Fase 1 | Schema do pg-boss |

## Estrutura

```
src/
  app/
    (auth)/          sign-in, sign-up, onboarding
    (app)/           dashboard, settings (area autenticada)
    api/auth/        Better Auth handler
  components/
    ui/              shadcn/ui
    app-sidebar.tsx
  db/
    schema/          auth, credentials, campaigns, leads, outreach, jobs, events
  lib/
    auth/            server, client, guards
    db/              client, tenant
    crypto/          credentials (pgcrypto)
docker/
  postgres/init/     scripts SQL de inicializacao
drizzle/             migrations geradas
docker-compose.yml       stack completa (prod)
docker-compose.dev.yml   so Postgres (dev)
Dockerfile               multi stage Next.js
drizzle.config.ts
```

## Scripts

- `pnpm dev` roda Next em modo dev
- `pnpm build` build de producao
- `pnpm typecheck` checa TypeScript
- `pnpm db:generate` gera nova migration a partir do schema
- `pnpm db:push` aplica schema diretamente (dev)
- `pnpm db:migrate` aplica migrations (prod)
- `pnpm db:studio` abre o Drizzle Studio

## Roadmap

- Fase 0 (atual): fundacao, auth multi tenant, credentials criptografadas
- Fase 1: scraping Google Places e Apify, qualificacao Claude, inbox
- Fase 2: envio Instagram DM (Playwright) e Gmail API, follow ups
- Fase 3: deploy VPS, observabilidade, rate limit global
