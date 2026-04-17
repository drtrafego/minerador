---
name: Minerador Claude Fase 1
description: Revisão QA da Fase 1 em 2026-04-12; pg-boss + workers + clientes API + Server Actions + UI de campanhas e leads
type: project
---

Revisão executada em 2026-04-12. Resultado: APROVADO COM RESSALVAS.

**Issues críticos:** 0
**Issues altos:** 3
**Issues médios:** 4
**Issues baixos:** 2

Principais bloqueadores HIGH:
- ingest.ts faz SELECT + INSERT separados sem ON CONFLICT, race condition real entre workers paralelos
- qualify.ts não reverte leads para "pending" quando Claude falha; ficam presos em "pending" sem qualificationJob apontando erro corretamente para o status do lead
- campaigns/[id] não tem error.tsx nem loading.tsx, nem campaigns/[id]/leads; apenas campaigns/ tem boundary

Decisão: devolver para correção dos 3 HIGH antes de avançar para Fase 2.

**Why:** race condition no ingest pode gerar leads duplicados que violam a uniqueIndex gerando exceção não tratada; leads presos em pending quebram o pipeline de qualification.
**How to apply:** verificar se esses três foram corrigidos antes de aprovar Fase 2.
