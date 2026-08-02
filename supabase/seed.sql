-- Semilla de desarrollo. La ejecuta `supabase db reset` automáticamente.
-- Los textos legales son provisionales: Luis debe confirmarlos antes de producción.

with c as (
  insert into public.clients (name, industry, status, timezone, contact_name, contact_email, notes)
  values (
    'Magen Insurance Inc', 'Insurance', 'active', 'America/New_York',
    'Luis Arenas', 'luis@mageninsurance.example',
    'Primer cliente y campo de prueba. Intake general fuera de horario en número de pruebas.'
  )
  returning id
), a as (
  insert into public.agents (
    client_id, module_type, name, description, provider, status, system_prompt
  )
  select c.id, 'voice', 'Intake general',
    'Atiende fuera de horario, entiende el motivo de la llamada y captura los datos.',
    'vapi', 'paused',
$prompt$Contestas el teléfono de Magen Insurance fuera del horario de oficina. Eres claro, cálido y breve.

Al contestar, di que eres un asistente automático de Magen Insurance y que la llamada se graba.

Tu trabajo es entender por qué llama la persona y tomar sus datos para que el equipo la contacte. Atiendes cualquier motivo: cancelaciones, cotizaciones, pagos, cambios de póliza, siniestros, documentos o preguntas generales.

Haz una pregunta a la vez. Confirma el teléfono de devolución repitiéndolo dígito por dígito.

Límites que no puedes cruzar:
- No confirmas cobertura ni das precios.
- No procesas cancelaciones, cambios ni pagos. Los registras para que una persona los gestione, y se lo dices así a quien llama.
- Si hay una emergencia en curso o alguien está herido, indica colgar y llamar al 911 de inmediato.

Cierra confirmando que alguien de Magen devolverá la llamada el siguiente día hábil.$prompt$
  from c
  returning id, client_id
)
insert into public.field_defs (agent_id, key, label, type, required, description, options, sort_order)
select a.id, f.key, f.label, f.type, f.required, f.description, f.options, f.sort_order
from a, (values
  ('caller_name',        'Nombre',              'text',    true,  'Nombre completo de quien llama', null::jsonb, 0),
  ('callback_phone',     'Teléfono',            'phone',   true,  'Mejor número para devolver la llamada', null, 1),
  ('reason_verbatim',    'Motivo (textual)',    'text',    true,  'El motivo en palabras de quien llama', null, 2),
  ('reason_category',    'Categoría',           'select',  true,  'Clasificación gruesa del motivo',
     '["cancelación","cotización","pago","cambio de póliza","siniestro","documentos","otro"]'::jsonb, 3),
  ('is_existing_client', '¿Cliente actual?',    'boolean', true,  'Si ya es asegurado de Magen', null, 4),
  ('policy_number',      'Número de póliza',    'text',    false, 'Solo si es cliente actual y lo tiene a mano', null, 5),
  ('urgency',            'Urgencia',            'select',  true,  'Si puede esperar al siguiente día hábil',
     '["normal","urgente"]'::jsonb, 6),
  ('summary',            'Resumen',             'text',    true,  'Resumen de la llamada para el equipo', null, 7)
) as f(key, label, type, required, description, options, sort_order);

insert into public.agent_actions (agent_id, type, config)
select id, 'email_per_run', '{"recipients":["pendiente@mageninsurance.example"]}'::jsonb
from public.agents;

insert into public.agent_actions (agent_id, type, config)
select id, 'email_digest', '{"recipients":["pendiente@mageninsurance.example"],"hour":7}'::jsonb
from public.agents;
