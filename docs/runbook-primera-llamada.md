# Runbook — de cero a la primera llamada de Magen

Todo lo de aquí necesita cuentas o llaves. El código está listo y probado; esto
es el trabajo de conectarlo.

Cada paso dice **cómo comprobar que salió bien**. Si un paso no se puede
verificar, no está hecho.

---

## 0. Lo que hay que tener antes de empezar

| Cuenta | Para qué | Quién |
|---|---|---|
| Supabase | Base y funciones en la nube | Miguel |
| Vapi | Agente de voz y número | Miguel |
| Resend | Correos | Miguel |

De Luis hacen falta tres cosas **antes** de que el número atienda a alguien real:

1. Los textos legales exactos: aviso de asistente automático y de grabación.
2. Los correos que reciben las llamadas y el resumen diario.
3. Cuánto tiempo se guardan grabaciones y datos personales.

---

## 1. Proyecto de Supabase en la nube

Sin esto no hay nada más: **Vapi no puede llamar a tu laptop.**

1. Crear un proyecto en [supabase.com](https://supabase.com). Región cercana a
   Florida (`us-east-1`). Guardar la contraseña de la base en un gestor.
2. Autenticar el CLI y enlazar:

```bash
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
```

3. Subir el esquema:

```bash
npx supabase db push
```

**Comprobación:** en el panel, `Table editor` muestra las 16 tablas y
`clients` está vacía.

> `db push` **no** ejecuta `seed.sql`: la semilla es de desarrollo. Los datos
> reales de Magen se cargan en el paso 4.

---

## 2. Desplegar las funciones

```bash
npx supabase functions deploy provider-webhook
npx supabase functions deploy daily-digest
```

Configurar los secretos (no van en el repo):

```bash
npx supabase secrets set \
  VAPI_WEBHOOK_SECRET="<inventar una cadena larga y aleatoria>" \
  VAPI_API_KEY="<del panel de Vapi>" \
  RESEND_API_KEY="<del panel de Resend>" \
  EMAIL_FROM="Switchboard <avisos@tu-dominio.com>" \
  CRON_SECRET="<otra cadena larga y aleatoria>"
```

**Comprobación:** la URL del webhook debe responder `401` sin credencial —
eso prueba que está viva y que rechaza a quien no debe.

```bash
curl -i -X POST https://<ref>.supabase.co/functions/v1/provider-webhook/vapi
```

---

## 3. Crear el usuario operador

En el panel, `Authentication` → `Add user` (con correo confirmado). Después, en
`SQL editor`:

```sql
insert into public.profiles (id, email, role)
values ('<uuid-del-usuario>', '<tu-correo>', 'operator');
```

**Comprobación:** entrar al console apuntado a la nube y ver el dashboard vacío
en vez de la pantalla de acceso.

> Sin la fila en `profiles` el usuario existe pero no ve nada: RLS no reconoce a
> nadie sin rol. No es un fallo, es el diseño.

---

## 4. Cargar a Magen

En el `SQL editor`, adaptando `supabase/seed.sql`. Antes de ejecutarlo, cambiar:

- El prompt, con los textos legales que confirme Luis.
- Los destinatarios `pendiente@mageninsurance.example` por los reales.
- **El idioma.** El prompt de la semilla está en español; si las llamadas de
  Magen son en inglés o bilingües, hay que traducirlo y ajustar `config`:

```sql
update public.agents
set config = jsonb_build_object(
  'language', 'en',
  'greeting', 'Thanks for calling Magen Insurance. I''m an automated assistant and this call is recorded. How can I help you?',
  'voiceId', 'burt',
  'maxDurationSeconds', 600
);
```

**Comprobación:** el console muestra a Magen con su agente y sus 8 campos.

---

## 5. Publicar el agente en Vapi

Desde la raíz del repo, con las variables cargadas:

```bash
npx tsx scripts/sync-agent.ts <agent-id>
```

**Comprobación:** en el panel de Vapi aparece el assistant con el prompt; en la
base, `agent_revisions` tiene la versión 1.

> Este es el paso **más probable de fallar la primera vez**. La forma del
> assistant se construyó desde la documentación, sin haberla probado nunca
> contra la API real. Si Vapi la rechaza, el error queda en `events` con tipo
> `agent.sync_failed` y el mensaje exacto de Vapi. El bloque a corregir está en
> un solo sitio: `buildAssistantConfig` en
> `supabase/functions/_shared/providers/vapi/index.ts`.

---

## 6. Número y webhook

1. Comprar un número en el panel de Vapi (a mano: gasta dinero real).
2. Atarlo al agente:

```bash
npx tsx scripts/attach-number.ts <agent-id> <phone-number-id>
```

3. Verificar en Vapi que el Server URL del assistant apunta a la función y que
   el secreto coincide con `VAPI_WEBHOOK_SECRET`.

**Comprobación:** llamar al número. Debe contestar con el saludo configurado.

---

## 7. La primera llamada real

Llamar, decir algo concreto (por ejemplo: querer cancelar una póliza), colgar.
Después:

```sql
select status, duration_sec, extraction_status from public.runs order by created_at desc limit 1;
select field_key, value_text from public.extracted_values order by id desc limit 10;
select component, cost_usd from public.usage_events order by id desc limit 10;
select type, level, message from public.events order by id desc limit 10;
```

**Lo primero que hay que hacer con esa llamada:** guardar el payload crudo como
fixture real.

```sql
select payload from public.run_raw_events order by id desc limit 1;
```

Reemplazar con él `tests/ingest/fixtures/vapi-end-of-call.json` y volver a
correr las pruebas. La fixture actual es sintética: sigue la documentación, pero
**los nombres de los campos de costo son lo que más varía entre versiones de
Vapi**. Hasta hacer esto, el desglose de costo no está verificado contra la
realidad.

---

## 8. Resumen diario

Programar el cron en el `SQL editor`:

```sql
select cron.schedule(
  'daily-digest',
  '0 12 * * *',  -- 12:00 UTC ≈ 7-8 a.m. en Florida según horario de verano
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/daily-digest',
    headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
  );
  $$
);
```

**Comprobación:** dispararlo a mano y ver que llega el correo.

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/daily-digest \
  -H "x-cron-secret: <CRON_SECRET>"
```

---

## 9. Console apuntando a la nube

```bash
# .env.local
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key del panel>
```

Para que el enlace público muestre datos reales en vez del demo, hay que añadir
esas dos variables como secretos del repositorio y pasarlas al build en
`.github/workflows/deploy.yml`. **Mientras no se haga, el enlace de Luis sigue
mostrando los datos de muestra** — que es exactamente lo que queremos hasta que
Magen tenga llamadas que enseñar.

---

## Orden de riesgo

Si algo va a fallar, será en este orden:

1. **La forma del assistant en Vapi** (paso 5) — nunca probada contra la API real.
2. **Los nombres de los campos de costo** (paso 7) — la fixture es sintética.
3. **El dominio de Resend** — verificarlo tarda y sin eso los correos rebotan.
4. **La calidad de la extracción** — será mala las primeras llamadas. Para eso
   existe el crudo: se reprocesa sin volver a llamar.
