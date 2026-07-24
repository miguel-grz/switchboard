import type { Run, RunStatus, TranscriptTurn } from '../types'

/**
 * Runs are generated deterministically (seeded LCG, anchored to local midnight)
 * so every screen has stable, "today"-relative data without a backend.
 */

interface RunTemplate {
  transcript: TranscriptTurn[]
  extracted: Record<string, string>
  baseDurationSec: number
}

const templates: Record<string, RunTemplate[]> = {
  'ag-claims': [
    {
      baseDurationSec: 262,
      transcript: [
        { speaker: 'agent', text: 'Meridian claims, I can get your claim started right now. Are you somewhere safe?' },
        { speaker: 'caller', text: 'Yeah, I’m okay. Someone rear-ended me at a light on Cicero about twenty minutes ago.' },
        { speaker: 'agent', text: 'Glad you’re safe. Let’s get this filed. Can you read me your policy number? It starts with MG.' },
        { speaker: 'caller', text: 'Hang on… MG-4471902.' },
        { speaker: 'agent', text: 'That’s MG-4-4-7-1-9-0-2 — correct?' },
        { speaker: 'caller', text: 'Correct.' },
        { speaker: 'agent', text: 'Was anyone injured, in either vehicle?' },
        { speaker: 'caller', text: 'No, we’re both fine. Just the bumper and the trunk won’t close.' },
        { speaker: 'agent', text: 'Understood. Did you exchange insurance information with the other driver?' },
        { speaker: 'caller', text: 'Yes, they have State Farm. I took photos of everything.' },
        { speaker: 'agent', text: 'Perfect, an adjuster will ask for those. Best number to reach you tomorrow?' },
        { speaker: 'caller', text: 'This one — 773-555-0134.' },
        { speaker: 'agent', text: 'You’re all set. Your claim is filed and an adjuster will call within one business day. Anything else?' },
        { speaker: 'caller', text: 'No, that was fast. Thanks.' },
      ],
      extracted: {
        policy_number: 'MG-4471902',
        incident_date: '{{runDate}}',
        incident_type: 'Auto collision',
        description: 'Rear-ended at a stoplight on Cicero Ave. Bumper damage, trunk will not close. Photos taken at scene.',
        injuries_reported: 'false',
        callback_phone: '+1 (773) 555-0134',
        other_party_insured: 'true',
      },
    },
    {
      baseDurationSec: 341,
      transcript: [
        { speaker: 'agent', text: 'Meridian claims, I can get your claim started right now. Are you somewhere safe?' },
        { speaker: 'caller', text: 'Yes — it’s not an emergency. We came home from a weekend away and the ceiling in the kitchen is dripping.' },
        { speaker: 'agent', text: 'I’m sorry — let’s get it documented. Your policy number, starting with MG?' },
        { speaker: 'caller', text: 'MG-2280457.' },
        { speaker: 'agent', text: 'MG-2-2-8-0-4-5-7. When did you first notice the leak?' },
        { speaker: 'caller', text: 'Tonight, around seven. But the stain looks like it’s been going a few days.' },
        { speaker: 'agent', text: 'Have you been able to stop the water, or is it still coming in?' },
        { speaker: 'caller', text: 'My husband shut the main off. It’s slowed to a drip.' },
        { speaker: 'agent', text: 'Good. Is any part of the ceiling sagging or at risk of coming down?' },
        { speaker: 'caller', text: 'There’s a bubble about the size of a dinner plate.' },
        { speaker: 'agent', text: 'Please keep everyone from standing under it. No injuries so far, correct?' },
        { speaker: 'caller', text: 'Correct.' },
        { speaker: 'agent', text: 'Best callback number for the adjuster? They’ll likely want photos of the bubble and the shutoff.' },
        { speaker: 'caller', text: '312-555-0158.' },
        { speaker: 'agent', text: 'Claim’s filed. An adjuster calls within one business day, and you’ll get a text confirmation shortly.' },
      ],
      extracted: {
        policy_number: 'MG-2280457',
        incident_date: '{{runDate}}',
        incident_type: 'Property — water',
        description: 'Ceiling leak in kitchen discovered after weekend away. Main water shut off; ceiling bubble ~30cm, possible multi-day leak.',
        injuries_reported: 'false',
        callback_phone: '+1 (312) 555-0158',
        other_party_insured: 'false',
      },
    },
    {
      baseDurationSec: 187,
      transcript: [
        { speaker: 'agent', text: 'Meridian claims, I can get your claim started right now. Are you somewhere safe?' },
        { speaker: 'caller', text: 'I’m fine. My windshield caught a rock on I-90, there’s a crack about a foot long.' },
        { speaker: 'agent', text: 'Easy one to file. Policy number, starting with MG?' },
        { speaker: 'caller', text: 'MG-9034186.' },
        { speaker: 'agent', text: 'MG-9-0-3-4-1-8-6, thank you. Is the crack in your line of sight while driving?' },
        { speaker: 'caller', text: 'It starts passenger side but it’s creeping toward the middle.' },
        { speaker: 'agent', text: 'Then don’t wait on it. No injuries, no other vehicle involved — correct?' },
        { speaker: 'caller', text: 'Right, just the rock.' },
        { speaker: 'agent', text: 'Best callback number? Glass claims usually get scheduled same-week.' },
        { speaker: 'caller', text: '847-555-0121.' },
        { speaker: 'agent', text: 'Done — claim filed. The glass vendor will call you to schedule. Drive safe.' },
      ],
      extracted: {
        policy_number: 'MG-9034186',
        incident_date: '{{runDate}}',
        incident_type: 'Auto glass',
        description: 'Rock strike on I-90, ~30cm windshield crack spreading toward driver line of sight.',
        injuries_reported: 'false',
        callback_phone: '+1 (847) 555-0121',
        other_party_insured: 'false',
      },
    },
  ],
  'ag-renewal': [
    {
      baseDurationSec: 128,
      transcript: [
        { speaker: 'agent', text: 'Hi, this is the renewal desk calling on behalf of Meridian Insurance — am I speaking with Robert Calloway?' },
        { speaker: 'caller', text: 'Speaking.' },
        { speaker: 'agent', text: 'Thanks, Robert. Your auto policy renews on the 15th of next month. Your agent has review slots Tuesday at 10 or Thursday at 2 — would either work?' },
        { speaker: 'caller', text: 'Thursday at 2 works. Actually — my daughter just got her license, does that need to come up?' },
        { speaker: 'agent', text: 'That’s exactly the kind of thing to cover in the review. I’ve noted it so your agent comes prepared. You’re booked for Thursday at 2.' },
        { speaker: 'caller', text: 'Great, thanks for the reminder.' },
      ],
      extracted: {
        policyholder_confirmed: 'true',
        renewal_intent: 'Wants changes',
        review_scheduled_for: '{{plus7}}',
        notes: 'Daughter newly licensed — needs to be added as a driver. Expect rate discussion.',
      },
    },
    {
      baseDurationSec: 74,
      transcript: [
        { speaker: 'agent', text: 'Hi, this is the renewal desk calling on behalf of Meridian Insurance — am I speaking with Elaine Marsh?' },
        { speaker: 'caller', text: 'Yes, but I’ll be honest, I’ve been getting quotes elsewhere. Your premium went up a lot last year.' },
        { speaker: 'agent', text: 'That’s fair, and worth raising with your agent directly — they can re-rate the policy before renewal. Would Tuesday at 10 or Thursday at 2 suit you?' },
        { speaker: 'caller', text: 'No, I’ll call if I decide to stay. Please don’t call again this week.' },
        { speaker: 'agent', text: 'Understood — I’ve noted no further calls this week. Thanks for your time, Elaine.' },
      ],
      extracted: {
        policyholder_confirmed: 'true',
        renewal_intent: 'Shopping around',
        review_scheduled_for: '',
        notes: 'Price-sensitive after last year’s increase. Requested no further calls this week. Agent should re-rate before reaching out.',
      },
    },
  ],
  'ag-exception': [
    {
      baseDurationSec: 176,
      transcript: [
        { speaker: 'agent', text: 'Cargoline exceptions — do you have the PRO number handy?' },
        { speaker: 'caller', text: 'Yeah, 227441905. I’m the driver, I’m at the dock and the receiver is refusing two of the six pallets. Says the shrink wrap is torn and there’s crush damage on top.' },
        { speaker: 'agent', text: 'PRO 227441905, refusal on 2 of 6 pallets, visible crush damage. Are they accepting the other four?' },
        { speaker: 'caller', text: 'Yes, they’re unloading those now.' },
        { speaker: 'agent', text: 'Good. Have them note the damage on the delivery receipt before you leave. The two refused pallets go back on your trailer — hold at the Charlotte terminal, I’m authorizing up to five days while claims sorts it out.' },
        { speaker: 'caller', text: 'Hold at Charlotte, got it. Do I need photos?' },
        { speaker: 'agent', text: 'Yes — wrap, crush damage, and the annotated receipt. To confirm: PRO 227441905, partial refusal for damage, four delivered, two held at Charlotte terminal, photos and annotated POD required. Correct?' },
        { speaker: 'caller', text: 'That’s it.' },
      ],
      extracted: {
        pro_number: '227441905',
        caller_role: 'Driver',
        exception_type: 'Damaged',
        disposition: 'Hold at terminal',
        redelivery_date: '',
        notes: 'Partial refusal: 2 of 6 pallets, crush damage. POD annotated. Photos required. Hold at Charlotte terminal ≤5 days.',
      },
    },
    {
      baseDurationSec: 143,
      transcript: [
        { speaker: 'agent', text: 'Cargoline exceptions — do you have the PRO number handy?' },
        { speaker: 'caller', text: 'It’s 331904772. This is Reyes Cabinet Works — your driver came at noon but our dock is blocked, we had a concrete pour today. Nobody told us the window.' },
        { speaker: 'agent', text: 'Sorry about that. PRO 331904772, no dock access today. When is the dock clear?' },
        { speaker: 'caller', text: 'Tomorrow after 9 a.m. we’re fine.' },
        { speaker: 'agent', text: 'I can authorize redelivery tomorrow with a 9-to-12 window. Anyone the driver should ask for?' },
        { speaker: 'caller', text: 'Ask for Tomás, and tell them to use the Fulton Street entrance, not the front.' },
        { speaker: 'agent', text: 'Noted — Fulton Street entrance, ask for Tomás, window 9 to 12 tomorrow. You’ll get a call thirty minutes out. Correct?' },
        { speaker: 'caller', text: 'Perfect, thank you.' },
      ],
      extracted: {
        pro_number: '331904772',
        caller_role: 'Consignee',
        exception_type: 'No dock access',
        disposition: 'Redeliver next day',
        redelivery_date: '{{plus1}}',
        notes: 'Dock blocked by concrete pour. Use Fulton St entrance, ask for Tomás. Window 09:00–12:00, call 30 min ahead.',
      },
    },
    {
      baseDurationSec: 94,
      transcript: [
        { speaker: 'agent', text: 'Cargoline exceptions — do you have the PRO number handy?' },
        { speaker: 'caller', text: '445120388. Driver here. GPS took me to a residential address, this is somebody’s house, not a business.' },
        { speaker: 'agent', text: 'PRO 445120388. The BOL shows 1440 Industry Way — what does your rate confirmation say?' },
        { speaker: 'caller', text: 'Mine says 144 Industry Way. Somebody fat-fingered a zero.' },
        { speaker: 'agent', text: 'This needs a corrected BOL before you can deliver — that’s a dispatch call. I’m escalating now; stay put, they’ll ring you inside ten minutes.' },
        { speaker: 'caller', text: 'Alright, I’ll grab lunch. Tell them to hurry.' },
      ],
      extracted: {
        pro_number: '445120388',
        caller_role: 'Driver',
        exception_type: 'Wrong address',
        disposition: 'Escalated to dispatch',
        redelivery_date: '',
        notes: 'Address mismatch: BOL 1440 Industry Way vs rate con 144 Industry Way. Corrected BOL required. Driver holding on site.',
      },
    },
  ],
  'ag-driver-checkin': [
    {
      baseDurationSec: 81,
      transcript: [
        { speaker: 'agent', text: 'Evening — Cargoline check-in. Tomorrow shows your first stop at Mercer Foods in Macon, dock window 7 to 9 a.m. Still good?' },
        { speaker: 'caller', text: 'Yep, I’m parked forty minutes out, no problem making seven.' },
        { speaker: 'agent', text: 'How many hours left on your seventy?' },
        { speaker: 'caller', text: 'Thirty-one and change.' },
        { speaker: 'agent', text: 'Noting 31. Truck and trailer all good?' },
        { speaker: 'caller', text: 'All good. Trailer door latch is sticky but it works.' },
        { speaker: 'agent', text: 'Logged the latch as a watch item. Have a good night.' },
      ],
      extracted: {
        first_stop_confirmed: 'true',
        hours_remaining: '31',
        equipment_issue: 'false',
        notes: 'Trailer door latch sticky — watch item, not blocking. Parked 40 min from first stop.',
      },
    },
    {
      baseDurationSec: 117,
      transcript: [
        { speaker: 'agent', text: 'Evening — Cargoline check-in. Tomorrow shows your first stop at Delta Fasteners in Knoxville at 8 a.m. Still good?' },
        { speaker: 'caller', text: 'That’s the thing — I picked up a vibration in the front end this afternoon. I don’t love it at highway speed.' },
        { speaker: 'agent', text: 'Understood, that’s a flag. Are you safe where you’re parked tonight?' },
        { speaker: 'caller', text: 'Yeah, I’m at the Pilot on 40. If a shop can look at it early I can still make Knoxville by ten, maybe.' },
        { speaker: 'agent', text: 'Don’t commit to the 8 a.m. yet. How many hours on your seventy?' },
        { speaker: 'caller', text: 'Forty-four.' },
        { speaker: 'agent', text: 'Logged. I’m flagging the vibration now — dispatch will call you within the hour about a shop and the Knoxville window. Sit tight.' },
        { speaker: 'caller', text: 'Appreciate it.' },
      ],
      extracted: {
        first_stop_confirmed: 'false',
        hours_remaining: '44',
        equipment_issue: 'true',
        notes: 'Front-end vibration at highway speed. Parked at Pilot on I-40. Needs shop eval before Knoxville 08:00 — dispatch to call tonight.',
      },
    },
  ],
  'ag-scheduler': [
    {
      baseDurationSec: 154,
      transcript: [
        { speaker: 'agent', text: 'Thanks for calling Brightside Dental. The office is closed, but I can schedule you right now. What do you need?' },
        { speaker: 'caller', text: 'Hi, I’m overdue for a cleaning. Probably by a year, honestly.' },
        { speaker: 'agent', text: 'No judgment — let’s fix that. Are you an existing patient with us?' },
        { speaker: 'caller', text: 'Yes, Karen Boyle. I used to see Dr. Raman.' },
        { speaker: 'agent', text: 'Welcome back, Karen. The soonest cleanings are Tuesday at 9:30 a.m. or Wednesday at 4. Any preference?' },
        { speaker: 'caller', text: 'Wednesday at 4, after work.' },
        { speaker: 'agent', text: 'Booked — Wednesday at 4 with the hygienist, and Dr. Raman will do your exam. Best number for the confirmation text?' },
        { speaker: 'caller', text: '720-555-0148.' },
        { speaker: 'agent', text: 'You’ll get a text shortly. See you Wednesday, Karen.' },
      ],
      extracted: {
        patient_name: 'Karen Boyle',
        patient_type: 'Returning',
        visit_reason: 'Cleaning',
        urgency: 'Routine',
        appointment_date: '{{plus5}}',
        callback_phone: '+1 (720) 555-0148',
        insurance_carrier: '',
      },
    },
    {
      baseDurationSec: 132,
      transcript: [
        { speaker: 'agent', text: 'Thanks for calling Brightside Dental. The office is closed, but I can schedule you right now. What do you need?' },
        { speaker: 'caller', text: 'My son bit into a frozen candy bar and half his molar came off. He’s not screaming but he says it hurts to breathe on it.' },
        { speaker: 'agent', text: 'Poor kid. Is there bleeding that won’t stop, or swelling in his face or jaw?' },
        { speaker: 'caller', text: 'No swelling, tiny bit of blood earlier, it stopped.' },
        { speaker: 'agent', text: 'Okay — a broken tooth with pain is something the on-call dentist should hear about tonight rather than waiting for morning. What’s your name and your son’s name?' },
        { speaker: 'caller', text: 'I’m Amanda Cortez, he’s Diego, he’s nine. We’ve been in before.' },
        { speaker: 'agent', text: 'Thanks, Amanda. Best number for the on-call dentist to reach you in the next few minutes?' },
        { speaker: 'caller', text: '303-555-0176.' },
        { speaker: 'agent', text: 'I’m paging Dr. Osei now. Keep the area clean, cold water only, no aspirin on the gum. Expect a call within fifteen minutes.' },
      ],
      extracted: {
        patient_name: 'Diego Cortez',
        patient_type: 'Returning',
        visit_reason: 'Broken tooth',
        urgency: 'Urgent — paged on-call',
        appointment_date: '',
        callback_phone: '+1 (303) 555-0176',
        insurance_carrier: '',
      },
    },
    {
      baseDurationSec: 168,
      transcript: [
        { speaker: 'agent', text: 'Thanks for calling Brightside Dental. The office is closed, but I can schedule you right now. What do you need?' },
        { speaker: 'caller', text: 'We just moved to Lakewood and the whole family needs a dentist. Can I set up two adults and a toddler?' },
        { speaker: 'agent', text: 'Absolutely, welcome to the neighborhood. Let’s start with your name.' },
        { speaker: 'caller', text: 'Sam Whittaker. My wife is Jules, and Theo is three.' },
        { speaker: 'agent', text: 'For the adults I can do back-to-back checkups Friday morning, 9 and 10. Theo would see Dr. Raman — she does pediatric — Friday at 10:30 so you’re all in one trip. Work?' },
        { speaker: 'caller', text: 'That’s perfect, one trip is the dream with a toddler.' },
        { speaker: 'agent', text: 'Do you have dental insurance? The front desk verifies benefits before your visit.' },
        { speaker: 'caller', text: 'Yes, Delta Dental through my employer.' },
        { speaker: 'agent', text: 'Noted. Best number for confirmations?' },
        { speaker: 'caller', text: '720-555-0192.' },
        { speaker: 'agent', text: 'All three booked for Friday. You’ll get new-patient forms by text — done before you arrive saves you twenty minutes.' },
      ],
      extracted: {
        patient_name: 'Sam Whittaker (+2 family)',
        patient_type: 'New',
        visit_reason: 'Checkup',
        urgency: 'Routine',
        appointment_date: '{{plus3}}',
        callback_phone: '+1 (720) 555-0192',
        insurance_carrier: 'Delta Dental',
      },
    },
  ],
}

const failureMessages = [
  'Provider webhook timed out after 30s — transcript recovered, extraction incomplete',
  'Call dropped mid-conversation (carrier disconnect) before required fields were captured',
  'ASR confidence below threshold for 40s of audio — extraction aborted per policy',
  'Provider returned 429 on session start — call never connected',
  'Extraction schema mismatch: field "disposition" received unmapped value',
]

/** Runs per agent per day, day 0 = today … day 13. Shapes weekly rhythm per client. */
const dailyPattern: Record<string, number[]> = {
  'ag-claims':         [5, 7, 6, 8, 5, 3, 2, 6, 7, 5, 8, 6, 2, 3],
  'ag-renewal':        [0, 0, 0, 0, 0, 0, 0, 4, 5, 4, 6, 3, 0, 0], // paused this week
  'ag-exception':      [4, 6, 5, 7, 6, 1, 1, 5, 6, 6, 7, 5, 1, 2],
  'ag-driver-checkin': [3, 4, 4, 4, 3, 0, 0, 4, 4, 3, 4, 4, 0, 0],
  'ag-scheduler':      [3, 4, 3, 5, 4, 4, 2, 3, 4, 4, 5, 3, 4, 2],
}

const agentClient: Record<string, string> = {
  'ag-claims': 'cl-meridian',
  'ag-renewal': 'cl-meridian',
  'ag-exception': 'cl-cargoline',
  'ag-driver-checkin': 'cl-cargoline',
  'ag-scheduler': 'cl-brightside',
}

function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
}

function iso(d: Date) {
  return d.toISOString()
}

function dayPlus(base: Date, days: number) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function buildRuns(): Run[] {
  const runs: Run[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const nowHour = new Date().getHours()

  for (const [agentId, pattern] of Object.entries(dailyPattern)) {
    const rand = lcg(agentId.length * 7919 + 17)
    const agentTemplates = templates[agentId]
    let seq = 0

    pattern.forEach((count, dayAgo) => {
      for (let i = 0; i < count; i++) {
        seq++
        const day = new Date(today)
        day.setDate(day.getDate() - dayAgo)
        // Spread calls across business hours; check-ins in the evening.
        const hour =
          agentId === 'ag-driver-checkin'
            ? 18 + Math.floor(rand() * 2)
            : 8 + Math.floor(rand() * 10)
        // Today: only emit runs whose hour has already "happened".
        if (dayAgo === 0 && hour > nowHour) continue
        day.setHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60))

        const tpl = agentTemplates[seq % agentTemplates.length]
        const r = rand()
        let status: RunStatus = 'completed'
        if (r > 0.94) status = 'failed'
        else if (r > 0.88) status = 'no_answer'

        const durationSec =
          status === 'no_answer'
            ? 12 + Math.floor(rand() * 20)
            : Math.floor(tpl.baseDurationSec * (0.75 + rand() * 0.6))
        const latencyMs = Math.floor(420 + rand() * 700 + (status === 'failed' ? 900 : 0))
        const costUsd = +(durationSec * 0.0031 + 0.012).toFixed(3)

        const runDate = day.toISOString().slice(0, 10)
        const extracted: Record<string, string> = {}
        if (status === 'completed') {
          for (const [k, v] of Object.entries(tpl.extracted)) {
            extracted[k] = v
              .replace('{{runDate}}', runDate)
              .replace('{{plus1}}', dayPlus(day, 1))
              .replace('{{plus3}}', dayPlus(day, 3))
              .replace('{{plus5}}', dayPlus(day, 5))
              .replace('{{plus7}}', dayPlus(day, 7))
          }
        }

        runs.push({
          id: `run_${agentId.slice(3, 5)}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}${String(1000 + seq).slice(1)}`,
          clientId: agentClient[agentId],
          agentId,
          startedAt: iso(day),
          durationSec,
          status,
          costUsd,
          latencyMs,
          errorMessage:
            status === 'failed'
              ? failureMessages[seq % failureMessages.length]
              : undefined,
          transcript:
            status === 'no_answer'
              ? [{ speaker: 'agent', text: '(No answer — call ended after ring timeout)' }]
              : tpl.transcript,
          extracted,
        })
      }
    })
  }

  // One live call right now, for the pulse.
  const live = new Date()
  live.setMinutes(live.getMinutes() - 2)
  runs.push({
    id: 'run_cl_live01',
    clientId: 'cl-meridian',
    agentId: 'ag-claims',
    startedAt: iso(live),
    durationSec: 118,
    status: 'in_progress',
    costUsd: 0.31,
    latencyMs: 540,
    transcript: [
      { speaker: 'agent', text: 'Meridian claims, I can get your claim started right now. Are you somewhere safe?' },
      { speaker: 'caller', text: 'Yes, I’m at home. It’s about a break-in at our garage overnight…' },
      { speaker: 'agent', text: 'I’m sorry to hear that. Have you already filed a police report?' },
      { speaker: 'caller', text: 'The officer just left, I have the report number here.' },
    ],
    extracted: {},
  })

  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export const runs: Run[] = buildRuns()
