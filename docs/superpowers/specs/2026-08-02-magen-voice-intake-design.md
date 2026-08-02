# Diseño — Slice funcional: intake de voz para Magen

**Fecha:** 2026-08-02
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
**Milestone:** 1 de 5 (ver *Fases siguientes*)

## 1. Contexto

El prototipo visual de Switchboard (operator console multi-tenant) fue aprobado por Luis Arenas
(Magen Insurance Inc). Su correo del 27/07/2026 da luz verde al desarrollo funcional y añade dos
requisitos estructurales:

1. El operator console es el dashboard **interno**. Cada cliente debe eventualmente tener su propio
   dashboard, más sencillo y enfocado en resultados.
2. Debe registrarse **usage y costo real por cliente y por agente/módulo** desde el inicio, para
   conocer el costo de operar cada cliente y manejar márgenes cuando existan planes.

Luis pide explícitamente que no se construyan esas vistas ahora, sino que **los datos y la estructura
queden preparados para hacerlo después sin rehacer la base**. Este diseño trata ambos puntos como
decisiones de esquema de día uno, no como features futuras.

## 2. Objetivo del milestone

Un agente de voz real de Magen que atiende llamadas en un número de pruebas, captura la información
de cualquier motivo de llamada, la almacena de forma estructurada, registra su costo real, notifica
por correo, y muestra todo en el operator console.

**Criterio de éxito:** se llama al número, se cuelga, y en menos de un minuto llega un correo con lo
capturado y la llamada aparece en el console con transcript, datos y costo.

## 3. Decisiones cerradas

| Decisión | Elección | Razón |
|---|---|---|
| Alcance | Slice vertical real | Descubre temprano el único riesgo real: calidad de extracción e integración con el proveedor |
| Caso de uso | Intake general fuera de horario | Cualquier motivo (cancelación, cotización, pago, siniestro…), no solo leads |
| Stack | Supabase + el SPA de Vite actual | RLS es el mecanismo nativo para "cada cliente ve solo lo suyo"; conserva lo ya aprobado |
| Proveedor de voz | Vapi | Reporta transcript, datos estructurados y **desglose de costo** por llamada |
| Enrutamiento | Número nuevo de pruebas | No toca la telefonía de producción de Magen |
| Estructura de captura | Universales + resumen; motivos soportados en esquema pero inactivos | Captura el 100% de llamadas sin guion rígido; los motivos se añaden con datos reales |
| Entrega | Correo por llamada + digest diario | Valida calidad de extracción de inmediato y sirve a Magen sin esperar al dashboard de cliente |
| Ingesta | Payload crudo inmutable **y** proyección | Permite reprocesar llamadas viejas al mejorar el prompt; respaldo auditable del costo |
| Costo | Ledger append-only con `cost_usd` y `billed_usd` | Margen = precio − costo; registrar ambos lados hace el histórico utilizable hacia atrás |

## 4. Alcance

### Incluye
- Esquema completo multi-tenant con RLS escrita y probada
- Ledger de usage y costo alimentado desde Vapi
- Un agente de voz de Magen configurado y operativo en un número nuevo
- Ingesta por webhook con payload crudo, proyección e idempotencia
- Correo por llamada y digest diario
- Console conectado en las vistas que muestran las llamadas de Magen: Runs, detalle de run,
  Client detail, Agent config

### No incluye (queda el esquema listo)
- Dashboard de cliente y login de usuarios de cliente
- Planes, precios y facturación (solo la columna `billed_usd` reservada)
- Módulos email, SMS y documentos (solo el catálogo)
- Desvío del número real de Magen
- Motivos con campos condicionales activos
- Modules y Monitoring del console: siguen con datos mock hasta la fase siguiente

## 5. Arquitectura

Sin servidor propio. El SPA habla directo con Supabase y el acceso lo decide RLS en la base. El único
código de servidor son cuatro Edge Functions.

```
Llamada → Vapi → [webhook firmado]
                      ↓
              run_raw_events          ← inmutable, fuente de verdad
                      ↓ proyección
   runs · transcript_turns · extracted_values · usage_events
                      ↓
        correo por llamada  →  digest diario (cron por timezone)
                      ↓
    Console (SPA) lee vía RLS con la sesión del usuario
```

**Edge Functions**

| Función | Responsabilidad |
|---|---|
| `vapi-webhook` | Verifica firma, escribe el crudo, proyecta, encola notificación |
| `send-call-email` | Correo por llamada vía Resend |
| `daily-digest` | Cron; un digest por cliente en su timezone |
| `reprocess-run` | Reproyecta desde el crudo con una nueva versión de extracción |

Las Edge Functions usan `service_role` y por tanto pasan por encima de RLS; RLS protege el acceso
desde el SPA, que es donde vive la sesión del usuario.

## 6. Modelo de datos

Postgres sobre Supabase. `gen_random_uuid()` para PKs de entidades, `bigserial` para tablas de alto
volumen y append-only.

### 6.1 Tenencia y acceso

```sql
clients (
  id uuid pk, name text not null, industry text not null,
  status text check (status in ('active','paused','onboarding')) default 'onboarding',
  timezone text not null default 'America/New_York',
  contact_name text, contact_email text, notes text,
  created_at timestamptz default now()
)

profiles (                              -- extiende auth.users
  id uuid pk references auth.users(id) on delete cascade,
  full_name text, email text not null,
  role text not null check (role in ('operator','client_user')),
  created_at timestamptz default now()
)

client_members (
  profile_id uuid references profiles(id) on delete cascade,
  client_id  uuid references clients(id)  on delete cascade,
  role text not null check (role in ('owner','viewer')) default 'viewer',
  primary key (profile_id, client_id)
)
```

`client_members` es la pieza que habilita el punto 1 de Luis. En este milestone no existirá ningún
`client_user`, pero las políticas se escriben y se prueban ahora.

### 6.2 Configuración de agentes

```sql
agents (
  id uuid pk,
  client_id uuid not null references clients(id) on delete cascade,
  module_type text not null check (module_type in ('voice','email','sms','documents')),
  name text not null, description text,
  channel text,                          -- número E.164 o dirección
  provider text not null check (provider in ('vapi','retell','custom')),
  provider_agent_id text,                -- id del assistant en el proveedor
  status text not null check (status in ('active','paused')) default 'paused',
  system_prompt text not null default '',
  extraction_version int not null default 1,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (provider, provider_agent_id)
)

agent_intents (                          -- vacío en v1
  id uuid pk,
  agent_id uuid not null references agents(id) on delete cascade,
  key text not null, label text not null, description text,
  sort_order int not null default 0,
  unique (agent_id, key)
)

field_defs (
  id uuid pk,
  agent_id uuid not null references agents(id) on delete cascade,
  intent_id uuid references agent_intents(id) on delete cascade,   -- NULL = campo universal
  key text not null, label text not null,
  type text not null check (type in ('text','number','boolean','date','select','phone')),
  required boolean not null default false,
  description text, options jsonb, sort_order int not null default 0,
  unique nulls not distinct (agent_id, intent_id, key)
)
```

`field_defs.intent_id` nullable es la bisagra del diseño: hoy solo hay universales; mañana se añaden
motivos con sus campos sin tocar la base. **Nota técnica:** el `unique` necesita `nulls not distinct`
(Postgres 15+, disponible en Supabase); sin eso los NULL no colisionan y se podrían crear campos
universales duplicados.

### 6.3 Ejecuciones

```sql
run_raw_events (                         -- append-only, nunca se actualiza salvo marcado de proceso
  id bigserial pk, provider text not null,
  provider_call_id text, event_type text not null,
  payload jsonb not null,
  signature_verified boolean not null default false,
  received_at timestamptz default now(),
  processed_at timestamptz, processing_error text,
  unique (provider, provider_call_id, event_type)
)

runs (
  id uuid pk,
  client_id uuid not null references clients(id),
  agent_id  uuid not null references agents(id),
  provider text not null, provider_call_id text not null,
  direction text check (direction in ('inbound','outbound')) default 'inbound',
  caller_number text,
  started_at timestamptz not null, ended_at timestamptz, duration_sec int,
  status text not null check (status in ('in_progress','completed','failed','no_answer')),
  ended_reason text, recording_url text, summary text,
  reason_category text, urgency text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','complete','partial','failed')),
  extraction_version int, latency_ms int,
  created_at timestamptz default now(),
  unique (provider, provider_call_id)
)

transcript_turns (
  id bigserial pk,
  run_id uuid not null references runs(id) on delete cascade,
  seq int not null,
  speaker text not null check (speaker in ('agent','caller')),
  text text not null, offset_ms int,
  unique (run_id, seq)
)

extracted_values (                       -- clave-valor: cambiar campos nunca altera el esquema
  id bigserial pk,
  run_id uuid not null references runs(id) on delete cascade,
  field_key text not null, intent_key text,
  value_text text, confidence numeric(4,3),
  extraction_version int not null,
  unique (run_id, field_key, extraction_version)
)
```

`extracted_values` guarda una fila por campo y versión de extracción. Al reprocesar con
`extraction_version = 2` conviven ambas versiones y se pueden comparar; el console lee la más alta.

**Sobre la duplicación deliberada:** `reason_category` y `urgency` viven a la vez como columnas de
`runs` y como filas de `extracted_values`. No es una inconsistencia: `extracted_values` es la verdad
versionada, y las columnas son una copia desnormalizada de la versión vigente para poder filtrar y
agrupar runs sin un join por cada consulta del console. La proyección las escribe juntas y
`reprocess-run` las actualiza juntas.

`run_raw_events.provider_call_id` es nullable en el tipo, pero todos los eventos que ingerimos
(`end-of-call-report` y `status-update`) lo traen siempre; un evento sin él se guarda con
`processing_error` y no se proyecta, en vez de romper la idempotencia del `unique`.

### 6.4 Usage y costo

```sql
usage_events (                           -- append-only, nunca se actualiza ni se borra
  id bigserial pk,
  client_id uuid not null references clients(id),
  agent_id uuid references agents(id),
  module_type text not null,
  run_id uuid references runs(id),
  provider text not null,
  component text not null check (component in ('telephony','stt','llm','tts','other')),
  quantity numeric not null,
  unit text not null check (unit in ('minutes','tokens','characters','calls')),
  cost_usd   numeric(12,6),              -- lo que nos cuesta (del proveedor)
  billed_usd numeric(12,6),              -- lo que cobramos; NULL hasta que existan planes
  currency text not null default 'USD',
  source_event_id text,
  occurred_at timestamptz not null, created_at timestamptz default now(),
  reconciled boolean not null default false,
  unique (provider, source_event_id, component)
)
```

Responde directamente las preguntas de Luis: costo por cliente, por agente y por módulo en cualquier
rango de fechas. `billed_usd` nulo hoy permite calcular márgenes sobre el histórico completo el día
que existan planes, en vez de empezar a medir desde cero.

**Privacidad interna:** `cost_usd` es información nuestra, no del cliente. Por eso `usage_events` es
legible **solo por operadores** (ver §7), sin excepción. Cuando llegue el dashboard de cliente, su
consumo no se abre relajando esta política, sino mediante una vista dedicada que proyecte únicamente
`billed_usd`, cantidad y fecha. Así el costo interno nunca queda a un error de política de distancia
de un cliente.

### 6.5 Notificaciones

```sql
notification_settings (
  client_id uuid pk references clients(id) on delete cascade,
  per_call_email boolean not null default true,
  daily_digest boolean not null default true,
  digest_hour int not null default 7,    -- en el timezone del cliente
  recipients text[] not null default '{}'
)

notifications_sent (
  id bigserial pk,
  client_id uuid not null references clients(id),
  run_id uuid references runs(id),       -- NULL en digest
  kind text not null check (kind in ('per_call','daily_digest')),
  recipients text[] not null,
  status text not null check (status in ('sent','failed')),
  error text, sent_at timestamptz default now()
)
```

## 7. Seguridad a nivel de fila

Dos funciones auxiliares en Postgres:

```sql
is_operator()            -- el perfil de auth.uid() tiene role = 'operator'
has_client_access(cid)   -- is_operator() OR existe client_members(auth.uid(), cid)
```

| Tabla | Lectura | Escritura |
|---|---|---|
| `clients`, `agents`, `agent_intents`, `field_defs` | `has_client_access` | solo operator |
| `runs`, `transcript_turns`, `extracted_values` | `has_client_access` | solo service_role |
| `usage_events` | **solo operator** | solo service_role |
| `run_raw_events` | **solo operator** | solo service_role |
| `notification_settings` | `has_client_access` | solo operator |
| `profiles`, `client_members` | propio perfil u operator | solo operator |

`extracted_values` y `transcript_turns` heredan el acceso por el `client_id` de su `run` mediante
subconsulta en la política.

## 8. Extracción y motivos

**Campos universales de v1** (`field_defs` con `intent_id = NULL`):

| Campo | Tipo | Requerido |
|---|---|---|
| `caller_name` | text | sí |
| `callback_phone` | phone | sí |
| `reason_verbatim` | text | sí — el motivo en palabras del cliente |
| `reason_category` | select | sí |
| `is_existing_client` | boolean | sí |
| `policy_number` | text | no |
| `urgency` | select (`normal`, `urgente`) | sí |
| `summary` | text | sí |

Opciones de `reason_category`: cancelación · cotización · pago · cambio de póliza · siniestro ·
documentos · otro.

La extracción la ejecuta Vapi al cerrar la llamada contra un JSON schema **generado desde
`field_defs`**, de modo que el constructor de campos del console sigue siendo la única fuente de
verdad. Cuando haya volumen real, las categorías frecuentes se promueven a `agent_intents` con campos
propios sin migración.

### Guardrails del prompt

No opcionales tratándose de seguros:

- El agente **toma el recado, no ejecuta**: no confirma cobertura, no cotiza precios y **no procesa
  cancelaciones**. Una cancelación que un bot dio por confirmada tiene consecuencias reales para el
  asegurado.
- Aviso al contestar de que es un asistente automático y de que la llamada se graba.
- Ante una emergencia en curso, instrucción de colgar y llamar al 911.

Los textos exactos los confirma Luis antes de salir a producción.

## 9. Errores y reprocesamiento

Principio: **se escribe el crudo primero; la ingesta nunca se pierde por un fallo aguas abajo.**

| Falla | Comportamiento |
|---|---|
| Webhook no llega | Vapi reintenta; además reconciliación diaria contra su API para rellenar huecos |
| Webhook duplicado | `unique` en `provider_call_id` y `source_event_id`: un run, un solo cargo |
| Extracción pobre | `extraction_status = 'partial'`; `reprocess-run` la rehace desde el crudo |
| Llamada cortada | `status = 'failed'`, se guarda el transcript parcial y **se registra el usage igual** |
| Correo falla | `notifications_sent` con error y reintento; nunca bloquea la ingesta |
| Vapi no reporta costo | `usage_events` con `cost_usd` nulo y `reconciled = false` para conciliar después |

## 10. Pruebas

- **Proyección** — fixtures con payloads reales de Vapi capturados en las primeras llamadas;
  verifican runs, turnos, valores y usage. Incluye el caso duplicado: mismo evento dos veces produce
  un run y **un solo cargo**.
- **RLS** — la prueba de mayor valor: un `client_user` de Magen no puede leer datos de otro cliente,
  ni `cost_usd` de ninguno. Se prueba contra Postgres real.
- **Extracción** — *golden set* con las primeras ~20 llamadas anotadas a mano, para medir si un
  cambio de prompt mejora o empeora en vez de adivinar.
- **End-to-end manual** — llamar al número, colgar, verificar correo y run en el console.

Vitest contra `supabase start` local, de modo que las pruebas de RLS corran sobre Postgres real y no
sobre un mock.

## 11. Riesgos y preguntas abiertas

| Tema | Estado |
|---|---|
| Textos legales (aviso de grabación, asistente automático) | Confirmar con Luis antes de producción |
| Destinatarios de los correos en Magen | Pendiente |
| Retención de grabaciones y datos personales | Definir política; son datos sensibles de asegurados |
| Campos exactos de costo en el webhook de Vapi | Verificar al integrar; el diseño no depende de su forma |
| Calidad de extracción inicial | Será baja por diseño las primeras semanas; el golden set existe para eso |

## 12. Fases siguientes

1. **Este milestone** — fundación + slice vertical de Magen
2. **Console conectado** — reemplazar los mocks restantes (Modules, Monitoring)
3. **Auth + dashboard de cliente** — punto 1 de Luis, sobre RLS ya escrita
4. **Planes y márgenes** — poblar `billed_usd`, encima del ledger existente
5. **Módulos email / SMS / documentos** — el catálogo ya existe
