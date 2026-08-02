# ADR 0001 — Supabase con RLS en lugar de un backend propio en Python

**Fecha:** 2026-08-02
**Estado:** aceptada
**Decide:** Miguel Ángel

## Contexto

Existía una propuesta alternativa (documento "Prompt para Claude Code — MVP funcional")
que planteaba un backend en Python 3.12 con FastAPI, SQLAlchemy, Alembic, JWT propio y
Docker Compose, con el aislamiento entre clientes resuelto en una capa de aplicación.

Ese documento se escribió sin conocimiento de la fundación de datos ya construida y
probada sobre Supabase, así que no representaba un requisito del cliente sino una
alternativa. Los siete principios de arquitectura que enumera ya estaban satisfechos por
otros medios.

## Decisión

Continuar sobre Supabase: Postgres gestionado, Auth y Edge Functions, con el aislamiento
entre clientes en seguridad a nivel de fila.

## Razones

1. **El aislamiento vive en la base, no en el código.** Un endpoint que olvide filtrar por
   cliente no puede devolver datos ajenos: Postgres lo impide. El enfoque alternativo lo
   confía a que ninguna consulta esquive nunca la capa común. Para un producto que vende
   aislamiento entre negocios que compiten entre sí, la garantía de la base es más
   defendible.
2. **Plazo.** El objetivo del cliente es 3-4 semanas hasta la primera llamada real.
   Reescribir auth, scoping, migraciones y las 46 pruebas existentes añadía entre semana y
   media y dos semanas antes de tocar el proveedor de voz.
3. **La decisión no es irreversible.** Supabase es Postgres estándar. Un servicio en Python
   puede apuntar a esta misma base cuando haga falta, sin migración.

## Consecuencias

**Aceptamos:**

- Las Edge Functions corren en Deno, con límites de CPU y duración por invocación. Sirven
  para voz, email y SMS; **no** servirán para el módulo de clasificación de documentos,
  que necesitará un worker aparte.
- Dependencia de Supabase Auth. Es la parte pegajosa: los usuarios viven en un schema
  propio y migrarlos después es trabajo real. El resto sale con `pg_dump`.

**Revisar esta decisión cuando:** aparezca el módulo de documentos, o el equipo que
mantiene el sistema deje de ser mayoritariamente de TypeScript.

## Ideas adoptadas de la propuesta alternativa

Tres eran mejores que el diseño original y se incorporan (ver ADR 0002):

1. Tabla `events` como log estructurado, en lugar de columnas de error dispersas.
2. `agent_revisions`: histórico inmutable de prompt y esquema, para saber con qué
   configuración corrió cada llamada.
3. Tarifas versionadas por fecha de vigencia, para calcular costo cuando el proveedor no
   lo reporta sin reescribir el histórico.

Se descartó `usage_monthly` por ahora: es una caché de agregación y todavía no hay un
problema de rendimiento que la justifique. Se añadirá cuando las consultas lo pidan.
