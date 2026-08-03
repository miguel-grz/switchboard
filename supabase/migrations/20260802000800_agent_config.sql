-- Configuración operativa del agente: voz, idioma, saludo y límites de llamada.
--
-- Va en jsonb y no en columnas porque cada módulo necesita cosas distintas —
-- voz y transcriptor solo tienen sentido en voz— y porque estos ajustes son
-- configuración del cliente, no del sistema. Ponerlos en el código haría que
-- cambiar la voz de un agente exigiera un despliegue.
alter table public.agents
  add column config jsonb not null default '{}'::jsonb;

comment on column public.agents.config is
  'Ajustes del proveedor por agente. Claves reconocidas en voz: greeting, '
  'language, voiceProvider, voiceId, transcriberProvider, transcriberModel, '
  'llmProvider, llmModel, temperature, silenceTimeoutSeconds, '
  'maxDurationSeconds, endCallMessage. Las ausentes usan los valores por '
  'defecto del adaptador.';

-- La revisión también congela la configuración: sin esto se sabría con qué
-- prompt corrió una llamada pero no con qué voz ni con qué idioma.
alter table public.agent_revisions
  add column config jsonb not null default '{}'::jsonb;
