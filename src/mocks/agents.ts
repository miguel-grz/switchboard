import type { Agent } from '../types'

export const agents: Agent[] = [
  {
    id: 'ag-claims',
    clientId: 'cl-meridian',
    name: 'Claims intake line',
    description: 'Inbound first-notice-of-loss. Captures the claim before a human adjuster ever picks up.',
    module: 'voice',
    provider: 'vapi',
    channel: '+1 (312) 555-0142',
    status: 'active',
    systemPrompt: `You answer the claims line for Meridian Insurance Group. You are calm, unhurried, and precise — callers may have just been in an accident.

Open with: "Meridian claims, I can get your claim started right now. Are you somewhere safe?"

Collect every required field before ending the call. Ask one question at a time. Confirm the policy number back digit by digit. If the caller reports injuries or an active emergency, tell them to hang up and call 911 first.

Never estimate coverage, fault, or payout amounts. If asked, say an adjuster will review and call back within one business day.`,
    fields: [
      { id: 'f1', name: 'policy_number', type: 'text', required: true, description: 'Meridian policy number, format MG-XXXXXXX' },
      { id: 'f2', name: 'incident_date', type: 'date', required: true, description: 'Date the loss occurred' },
      { id: 'f3', name: 'incident_type', type: 'select', required: true, description: 'Category of loss', options: ['Auto collision', 'Auto glass', 'Property — water', 'Property — fire', 'Theft', 'Other'] },
      { id: 'f4', name: 'description', type: 'text', required: true, description: 'Caller’s account of what happened, in their words' },
      { id: 'f5', name: 'injuries_reported', type: 'boolean', required: true, description: 'Whether anyone was injured' },
      { id: 'f6', name: 'callback_phone', type: 'phone', required: true, description: 'Best number for the adjuster to reach the caller' },
      { id: 'f7', name: 'other_party_insured', type: 'boolean', required: false, description: 'Whether another party’s insurer is involved' },
    ],
    lastRunAt: '',
    createdAt: '2026-02-18',
  },
  {
    id: 'ag-renewal',
    clientId: 'cl-meridian',
    name: 'Renewal outreach',
    description: 'Outbound calls to policyholders 30 days before expiry. Books a review with their agent.',
    module: 'voice',
    provider: 'vapi',
    channel: '+1 (312) 555-0177',
    status: 'paused',
    systemPrompt: `You call Meridian policyholders whose policies renew within 30 days. You are friendly and brief — this is a courtesy call, not a sales call.

Confirm you are speaking with the policyholder before mentioning any policy details. Offer two concrete time slots for a renewal review with their agent. If they decline, thank them and note the decline — do not push.

If you reach voicemail, leave the scripted message and mark the outcome accordingly.`,
    fields: [
      { id: 'f1', name: 'policyholder_confirmed', type: 'boolean', required: true, description: 'Identity confirmed before discussing the policy' },
      { id: 'f2', name: 'renewal_intent', type: 'select', required: true, description: 'Stated intent for the upcoming renewal', options: ['Will renew', 'Wants changes', 'Shopping around', 'Will not renew', 'Undecided'] },
      { id: 'f3', name: 'review_scheduled_for', type: 'date', required: false, description: 'Date of the booked renewal review, if any' },
      { id: 'f4', name: 'notes', type: 'text', required: false, description: 'Anything the agent should know before the review' },
    ],
    lastRunAt: '',
    createdAt: '2026-04-02',
  },
  {
    id: 'ag-exception',
    clientId: 'cl-cargoline',
    name: 'Delivery exception line',
    description: 'Inbound line for drivers and consignees when a delivery goes sideways — refusals, damage, wrong address.',
    module: 'voice',
    provider: 'retell',
    channel: '+1 (704) 555-0119',
    status: 'active',
    systemPrompt: `You handle Cargoline's delivery exception line. Callers are drivers at a stop or consignees expecting freight. Be fast and concrete — the driver is on the clock.

Identify the shipment first: PRO number, or origin + consignee name if the caller doesn't have it. Classify the exception, capture disposition instructions, and read the instructions back before hanging up.

You can authorize: redelivery next business day, hold at terminal up to 5 days. Anything else — refused hazmat, claims over $500, driver safety issues — transfer to dispatch immediately.`,
    fields: [
      { id: 'f1', name: 'pro_number', type: 'text', required: true, description: 'Shipment PRO number, 9 digits' },
      { id: 'f2', name: 'caller_role', type: 'select', required: true, description: 'Who is calling', options: ['Driver', 'Consignee', 'Shipper', 'Broker'] },
      { id: 'f3', name: 'exception_type', type: 'select', required: true, description: 'What went wrong', options: ['Refused', 'Damaged', 'Wrong address', 'No dock access', 'Missed window', 'Other'] },
      { id: 'f4', name: 'disposition', type: 'select', required: true, description: 'Agreed next step', options: ['Redeliver next day', 'Hold at terminal', 'Return to shipper', 'Escalated to dispatch'] },
      { id: 'f5', name: 'redelivery_date', type: 'date', required: false, description: 'Committed redelivery date, if rescheduled' },
      { id: 'f6', name: 'notes', type: 'text', required: false, description: 'Access codes, dock hours, contact on site' },
    ],
    lastRunAt: '',
    createdAt: '2026-04-05',
  },
  {
    id: 'ag-driver-checkin',
    clientId: 'cl-cargoline',
    name: 'Driver check-in',
    description: 'Outbound end-of-day calls to owner-operators: confirm tomorrow’s first stop and capture hours.',
    module: 'voice',
    provider: 'retell',
    channel: '+1 (704) 555-0163',
    status: 'active',
    systemPrompt: `You call Cargoline owner-operators between 18:00 and 20:00 local time. Keep it under two minutes — drivers are ending a long day.

Confirm tomorrow's first stop and appointment window. Capture remaining drive hours for dispatch planning. If the driver reports a mechanical issue or an hours-of-service conflict, flag it and tell them dispatch will call within the hour.`,
    fields: [
      { id: 'f1', name: 'first_stop_confirmed', type: 'boolean', required: true, description: 'Driver confirmed tomorrow’s first stop' },
      { id: 'f2', name: 'hours_remaining', type: 'number', required: true, description: 'Drive hours left on the 70-hour clock' },
      { id: 'f3', name: 'equipment_issue', type: 'boolean', required: true, description: 'Any mechanical or trailer issue reported' },
      { id: 'f4', name: 'notes', type: 'text', required: false, description: 'Anything dispatch should act on tonight' },
    ],
    lastRunAt: '',
    createdAt: '2026-05-20',
  },
  {
    id: 'ag-scheduler',
    clientId: 'cl-brightside',
    name: 'Appointment scheduler',
    description: 'After-hours and overflow scheduling. Books cleanings and triages urgent calls to the on-call line.',
    module: 'voice',
    provider: 'vapi',
    channel: '+1 (720) 555-0186',
    status: 'active',
    systemPrompt: `You answer for Brightside Dental when the front desk is closed or busy. Warm, efficient, reassuring.

For routine requests (cleaning, checkup, whitening consult) offer the two soonest matching slots. For anything involving pain, swelling, bleeding, or a broken tooth, classify it urgent: collect a callback number and page the on-call dentist — do not attempt to schedule it yourself.

New patients: capture insurance carrier so the front desk can verify benefits before the visit. Never quote treatment prices.`,
    fields: [
      { id: 'f1', name: 'patient_name', type: 'text', required: true, description: 'Full name as it should appear in the chart' },
      { id: 'f2', name: 'patient_type', type: 'select', required: true, description: 'New or returning patient', options: ['New', 'Returning'] },
      { id: 'f3', name: 'visit_reason', type: 'select', required: true, description: 'What the visit is for', options: ['Cleaning', 'Checkup', 'Toothache', 'Broken tooth', 'Whitening consult', 'Other'] },
      { id: 'f4', name: 'urgency', type: 'select', required: true, description: 'Triage outcome', options: ['Routine', 'Urgent — paged on-call'] },
      { id: 'f5', name: 'appointment_date', type: 'date', required: false, description: 'Booked slot, if scheduled' },
      { id: 'f6', name: 'callback_phone', type: 'phone', required: true, description: 'Number for confirmations and callbacks' },
      { id: 'f7', name: 'insurance_carrier', type: 'text', required: false, description: 'Dental insurance carrier, for new patients' },
    ],
    lastRunAt: '',
    createdAt: '2026-05-12',
  },
]
