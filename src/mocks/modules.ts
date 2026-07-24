import type { ModuleInfo } from '../types'

export const modules: ModuleInfo[] = [
  {
    type: 'voice',
    name: 'Voice',
    status: 'available',
    description:
      'Inbound and outbound phone agents. Answer, qualify, schedule, and capture structured data from live calls.',
    capabilities: [
      'Inbound answering & outbound campaigns',
      'Structured field extraction per call',
      'Full transcripts and recordings',
      'Warm transfer to a human line',
    ],
    providers: ['Vapi', 'Retell', 'Custom SIP'],
  },
  {
    type: 'email',
    name: 'Email',
    status: 'coming_soon',
    description:
      'Agents that triage shared inboxes, draft replies in the client’s voice, and extract data from attachments.',
    capabilities: [
      'Shared inbox triage & routing',
      'Draft-for-approval or full auto-reply',
      'Attachment parsing into fields',
    ],
    providers: ['SMTP / IMAP', 'Gmail', 'Microsoft 365'],
  },
  {
    type: 'sms',
    name: 'SMS',
    status: 'coming_soon',
    description:
      'Two-way texting for confirmations, reminders, and status updates on the same numbers as voice.',
    capabilities: [
      'Appointment confirmations & reminders',
      'Status notification campaigns',
      'Keyword opt-in / opt-out handling',
    ],
    providers: ['Twilio', 'Telnyx'],
  },
  {
    type: 'documents',
    name: 'Document processing',
    status: 'coming_soon',
    description:
      'Extract the same configurable fields from uploaded documents — forms, invoices, ID cards, claim photos.',
    capabilities: [
      'PDF & image field extraction',
      'Human review queue for low confidence',
      'Exports to CSV or webhook',
    ],
    providers: ['Native OCR pipeline'],
  },
]
