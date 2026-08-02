# Switchboard — operator console prototype

Visual-only prototype (no backend) of a multi-tenant AI agent platform: one operator runs
voice (and later email/SMS/document) agents on behalf of client businesses across industries.
Built to validate direction with stakeholders — every number, transcript, and toggle is mock data.

## Run it

```bash
npm install
npm run dev
```

## Base de datos (desarrollo)

Requiere Docker en ejecución.

```bash
npm run db:start     # levanta Postgres, Auth y API en local
npm run db:reset     # reaplica migraciones y siembra datos de Magen
npm run test:db      # ejecuta las pruebas de esquema y RLS
npm run db:types     # regenera src/lib/database.types.ts
```

Las migraciones viven en `supabase/migrations/` y no se editan una vez aplicadas:
cada cambio va en una migración nueva. Cada migración crea sus tablas, concede
privilegios y activa RLS en el mismo archivo, para que no exista ninguna ventana
en la que una tabla esté creada pero desprotegida.

## What's here

- **Dashboard** — cross-client metrics, 7-day activity, failed-run alerts, recent runs (with loading skeletons).
- **Clients** — 4 fictional businesses (insurance, logistics, dental, real estate); one is mid-onboarding to show empty states.
- **Client detail** — Overview / Agents / Data captured / Settings tabs.
- **Agent configuration** — system prompt, swappable provider (Vapi / Retell / custom), and a dynamic field builder (add, remove, reorder, required, live schema preview).
- **Runs** — filterable log; row click opens transcript, extracted fields, and an audio placeholder.
- **Modules** — voice live; email, SMS, documents as coming-soon cards (plug-in architecture).
- **Monitoring** — error rate, latency percentiles + distribution, errors grouped by client.

The top-bar scope switcher filters Dashboard, Runs, and Monitoring to a single client.

## Structure

- `src/mocks/` — typed mock data. `runs.ts` generates deterministic runs anchored to "today" so
  charts always have current data; transcripts are hand-written per agent.
- `src/lib/metrics.ts` — all aggregations derived from the runs array.
- `src/pages/`, `src/components/` — screens and shared UI (panels, badges, drawer, charts).

Stack: Vite, React, TypeScript, Tailwind v4, React Router, Recharts, lucide-react.
Interactions are local state only — nothing persists on reload.
