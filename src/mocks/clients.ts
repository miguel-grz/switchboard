import type { Client } from '../types'

export const clients: Client[] = [
  {
    id: 'cl-meridian',
    name: 'Meridian Insurance Group',
    industry: 'Insurance',
    status: 'active',
    modules: ['voice'],
    contactName: 'Dana Whitfield',
    contactEmail: 'dwhitfield@meridianins.example',
    timezone: 'America/Chicago',
    createdAt: '2026-02-11',
    notes:
      'First production client. Claims intake and renewal outreach on the voice module. Wants email module for adjuster follow-ups when available.',
  },
  {
    id: 'cl-cargoline',
    name: 'Cargoline Freight',
    industry: 'Logistics',
    status: 'active',
    modules: ['voice', 'sms'],
    contactName: 'Marcus Oyelaran',
    contactEmail: 'm.oyelaran@cargoline.example',
    timezone: 'America/New_York',
    createdAt: '2026-03-28',
    notes:
      'Delivery exception line handles driver and consignee calls. SMS module reserved for shipment status pings (pending rollout).',
  },
  {
    id: 'cl-brightside',
    name: 'Brightside Dental',
    industry: 'Healthcare — Dental',
    status: 'active',
    modules: ['voice'],
    contactName: 'Dr. Priya Raman',
    contactEmail: 'frontdesk@brightsidedental.example',
    timezone: 'America/Denver',
    createdAt: '2026-05-06',
    notes:
      'After-hours appointment scheduling and recall reminders. Practice management sync is manual for now — export captured fields weekly.',
  },
  {
    id: 'cl-harborkey',
    name: 'Harbor & Key Realty',
    industry: 'Real estate',
    status: 'onboarding',
    modules: ['voice'],
    contactName: 'Sofia Deluca',
    contactEmail: 'sofia@harborkey.example',
    timezone: 'America/Los_Angeles',
    createdAt: '2026-07-17',
    notes:
      'Signed last week. Listing inquiry line scoped; agent configuration pending script approval from their broker of record.',
  },
]

export const industryOptions = [
  'Insurance',
  'Logistics',
  'Healthcare — Dental',
  'Real estate',
  'Home services',
  'Legal',
]
