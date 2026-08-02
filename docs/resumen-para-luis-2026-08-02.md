# Arquitectura del prototipo funcional — resumen

**Para:** Luis Arenas · **De:** Miguel Ángel · **2 de agosto de 2026**

Respondo a tu pregunta de si cambiaría algo en la arquitectura con la visión de negocio en mente.
Cambié dos cosas y confirmé el resto. Abajo el detalle sin tecnicismos.

---

## Qué vamos a construir primero

Un agente de voz real para Magen, en un **número nuevo de pruebas** — no tocamos el teléfono de la
oficina. Atiende, entiende por qué llama la persona (cancelación, cotización, pago, siniestro,
cualquier motivo), toma los datos y los guarda. Al colgar sale un correo con lo captado, y cada
mañana un resumen de todo lo de la noche.

Todo eso aparece en el Operator Console que ya viste, ahora con llamadas reales en vez de datos de
muestra.

**Plazo:** encaja en las 3–4 semanas que planteaste.

## Lo que cambié después de leer tu correo

**1. No quedar atados a Vapi.** Toda la parte que "habla" con Vapi queda aislada en una sola pieza
del sistema. Cambiar a Retell más adelante significa escribir esa pieza otra vez, no rehacer la
plataforma. Dos advertencias honestas: la calidad con la que el bot entiende a la gente sí depende
del proveedor, así que un cambio obliga a revalidar; y los números de teléfono son del proveedor, así
que habría que portarlos.

**2. Los workflows son configuración, no programación.** En lugar de dejar "manda un correo" escrito
en el código, cada agente tiene una lista de acciones que ocurren al terminar la llamada. Hoy hay una
sola (el correo). Mañana, conectar el CRM de un cliente o mandar un SMS solo cuando sea urgente es
agregar un renglón, no reprogramar.

## Lo que ya estaba resuelto y confirmo

- **Multi-cliente desde el primer día.** Cada dato nace con dueño. Cuando construyamos el dashboard
  de cada cliente, solo verá lo suyo — eso está garantizado en la base de datos, no en la pantalla,
  que es donde suelen ocurrir las filtraciones.
- **Nada específico de seguros.** Palabras como "póliza" o "cancelación" son *configuración del
  agente de Magen*, no parte del sistema. Una clínica dental o una transportadora se configuran con
  sus propios campos sin tocar una línea de código.
- **Usage y costo real por cliente, agente y módulo**, como pediste. Con un detalle que agrego: para
  manejar márgenes hacen falta los dos lados, costo y precio. Guardamos ambos desde ahora, aunque el
  precio quede vacío hasta que definas los planes — así el día que existan, podrás calcular márgenes
  sobre todo el historial y no empezar a medir desde cero.
- **Monitoreo central.** No lo construimos ahora, pero este milestone ya genera todos los datos que
  ese sistema necesitará.

## Una decisión de producto que quiero que valides

El bot **toma el recado, no ejecuta**. No confirma cobertura, no da precios y **no procesa
cancelaciones**: las registra para que alguien de Magen las gestione. Si un bot le dice a un asegurado
que su cancelación quedó hecha y no fue así, el problema es de ustedes y del cliente. Prefiero que
esto sea decisión tuya y no un supuesto mío.

## Lo que necesito de ti antes de la primera llamada real

1. **Textos legales**: el aviso de que es un asistente automático y de que la llamada se graba.
2. **Quién recibe los correos** de cada llamada y el resumen diario.
3. **Cuánto tiempo guardamos grabaciones y datos personales** de quien llama. Son datos sensibles y
   conviene definir la política antes, no después.

Nada de esto bloquea el arranque; lo necesito antes de que el agente atienda a alguien real.

## Cómo evitamos "rehacer la base"

Las decisiones que después son carísimas de cambiar quedan tomadas ahora: quién es dueño de cada
dato, cómo se registra el costo, cómo se aísla el proveedor y cómo se configuran los workflows. Lo
que dejamos para después son **pantallas y funciones**, que se agregan encima sin tocar los cimientos
— que es justo lo que pediste.
