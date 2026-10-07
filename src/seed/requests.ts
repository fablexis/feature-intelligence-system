/**
 * The raw inbound corpus: 55 requests across five channels.
 *
 * NOTE: there is deliberately **no label field here**. Ground truth lives in
 * src/seed/labels.ts, which scripts/seed.ts never imports — so the demo
 * database cannot be contaminated with the answers. See docs/TASKS.md#c6.
 *
 * Voices differ by channel on purpose. A CSM note is third-person and
 * paraphrased; a customer writes first-person and often frustrated; a support
 * ticket is clipped and agent-authored; an internal note argues for priority;
 * an AE note is deal-shaped. The extractor has to cope with all five.
 */
export type SeedRequest = {
  id: string;
  title: string;
  bodyRaw: string;
  submitterKind: 'customer' | 'prospect' | 'support' | 'internal';
  source: 'csm_note' | 'ae_note' | 'support_ticket' | 'internal' | 'customer_direct';
  accountSlug?: string;
  createdAt: string;
};

export const SEED_REQUESTS: SeedRequest[] = [
  // ─── ledger sync / manual re-entry (7) ───
  { id: 'r01a', title: 'CSV export of invoice lines', bodyRaw: 'Spoke with their AR lead on Thursday. She wants a CSV export button on the invoice list so the detail can be downloaded.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'northwind', createdAt: '2026-07-29T09:12:00Z' },
  { id: 'r01b', title: 'No integration with our general ledger', bodyRaw: 'Everything has to be copied across from your system into ours. There is no sync at all.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'calder-health', createdAt: '2026-08-04T14:40:00Z' },
  { id: 'r01c', title: 'API for pulling invoice detail?', bodyRaw: 'Customer asks whether an endpoint exists to fetch invoice records programmatically. Advised none today.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'orchard-labs', createdAt: '2026-08-11T11:05:00Z' },
  { id: 'r01d', title: 'Finance teams keep asking for a NetSuite connector', bodyRaw: 'Third deal this quarter where the buyer wants a direct NetSuite link. Worth a look.', submitterKind: 'internal', source: 'internal', createdAt: '2026-08-18T16:22:00Z' },
  { id: 'r01e', title: 'Prospect needs ERP sync before signing', bodyRaw: 'They will not move forward without a two-way feed into their ERP. Blocking the deal.', submitterKind: 'prospect', source: 'ae_note', accountSlug: 'meridian-freight', createdAt: '2026-08-26T10:30:00Z' },
  { id: 'r01f', title: 'Copy and paste between tabs all day', bodyRaw: 'I live in a spreadsheet moving numbers out of your reports.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'gaslight', createdAt: '2026-09-02T08:55:00Z' },
  { id: 'r01g', title: 'Double entry is wearing the team down', bodyRaw: 'Figures get keyed in twice, once here and once downstream.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'brightline', createdAt: '2026-09-15T13:18:00Z' },

  // ─── change history (5) ───
  { id: 'r02a', title: 'Who edited this invoice?', bodyRaw: 'Their managing partner asked how to identify which user changed an invoice and when. No route to it today.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'harbor-grey', createdAt: '2026-07-31T15:02:00Z' },
  { id: 'r02b', title: 'Our auditors rejected the evidence pack', bodyRaw: 'External reviewers wanted a full history of amendments with timestamps and names. We could not produce one and took a finding.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'vantage-foods', createdAt: '2026-08-07T09:47:00Z' },
  { id: 'r02c', title: 'Need a change log on invoices', bodyRaw: 'Practice manager reports a dispute where nobody could establish what had been altered.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'pinehurst', createdAt: '2026-08-20T12:31:00Z' },
  { id: 'r02d', title: 'Compliance wants mutation history', bodyRaw: 'Our SOC 2 work will require an immutable record of writes.', submitterKind: 'internal', source: 'internal', createdAt: '2026-09-01T17:10:00Z' },
  { id: 'r02e', title: 'They cannot answer "who did this"', bodyRaw: 'During the QBR their controller described chasing a discrepancy for two days with no trail to follow.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'calder-health', createdAt: '2026-09-18T11:25:00Z' },

  // ─── credit approval controls (5) ───
  { id: 'r03a', title: 'Approval step for credit notes over $10k', bodyRaw: 'They would like a second signoff before a large credit note is issued.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'northwind', createdAt: '2026-08-03T10:08:00Z' },
  { id: 'r03b', title: 'Anyone can wipe a balance with no oversight', bodyRaw: 'Today a junior member of my team is able to zero out what a customer owes and nobody else reviews it. That is a control gap.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'summit-freight', createdAt: '2026-08-14T13:52:00Z' },
  { id: 'r03c', title: 'Can we require two people for refunds?', bodyRaw: 'Finance lead would like dual authorisation on anything going back to a client.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'kestrel', createdAt: '2026-08-27T15:44:00Z' },
  { id: 'r03d', title: 'Write-off limits requested in three deals', bodyRaw: 'Procurement questionnaires keep raising thresholds and delegated authority.', submitterKind: 'internal', source: 'internal', createdAt: '2026-09-08T09:33:00Z' },
  { id: 'r03e', title: 'Need maker-checker on adjustments', bodyRaw: 'Our internal audit flagged that one person can both raise and release an adjustment.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'vantage-foods', createdAt: '2026-09-22T14:16:00Z' },

  // ─── dunning segmentation (4) ───
  { id: 'r04a', title: 'Customise dunning reminders per segment', bodyRaw: 'They would like different reminder schedules for enterprise and small customers.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'kestrel', createdAt: '2026-08-06T11:40:00Z' },
  { id: 'r04b', title: 'Chasing payment the same way for everyone looks bad', bodyRaw: 'A big account receives an identical nagging note to a tiny one. My relationship managers find it embarrassing.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'tideline', createdAt: '2026-08-21T16:05:00Z' },
  { id: 'r04c', title: 'Reminder cadence is fixed?', bodyRaw: 'Caller enquired whether the chase schedule can vary by account tier. Confirmed it cannot.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'fernwood', createdAt: '2026-09-04T10:19:00Z' },
  { id: 'r04d', title: 'Collections wants tiered outreach', bodyRaw: 'Our own AR team raised the same point about tone for strategic logos.', submitterKind: 'internal', source: 'internal', createdAt: '2026-09-25T13:02:00Z' },

  // ─── FX at close (4) ───
  { id: 'r05a', title: 'Multi-currency invoices use the wrong exchange rate at close', bodyRaw: 'Invoices in EUR convert at the invoice date rate rather than the period end rate.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'brightline', createdAt: '2026-08-05T09:28:00Z' },
  { id: 'r05b', title: 'Our numbers do not match the bank', bodyRaw: 'When we compare what landed in our account against what the system reports, there is always a gap on foreign deals. Finance writes a manual adjustment every time.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'vantage-foods', createdAt: '2026-08-19T15:37:00Z' },
  { id: 'r05c', title: 'FX revaluation question', bodyRaw: 'Ticket: controller enquired how revaluation is handled between posting and settlement.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'northwind', createdAt: '2026-09-09T12:14:00Z' },
  { id: 'r05d', title: 'Euro totals drift by a few hundred', bodyRaw: 'Small differences pile up and we cannot tie out at month end.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'orchard-labs', createdAt: '2026-09-28T08:41:00Z' },

  // ─── identity lifecycle (4) ───
  { id: 'r06a', title: 'SAML SSO and SCIM support', bodyRaw: 'Their IT group requires SAML single sign-on plus SCIM provisioning.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'calder-health', createdAt: '2026-08-10T10:55:00Z' },
  { id: 'r06b', title: 'Offboarding is a security risk for us', bodyRaw: 'When somebody leaves the firm, IT has to remember to remove them here by hand. Last quarter two leavers kept access for weeks.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'harbor-grey', createdAt: '2026-08-24T14:08:00Z' },
  { id: 'r06c', title: 'Prospect blocked on directory sync', bodyRaw: 'Security review will not pass without automated user lifecycle from Okta.', submitterKind: 'prospect', source: 'ae_note', accountSlug: 'meridian-freight', createdAt: '2026-09-11T16:30:00Z' },
  { id: 'r06d', title: 'Access reviews are manual for every customer', bodyRaw: 'Support spends real time on password resets that single sign-on would remove.', submitterKind: 'internal', source: 'internal', createdAt: '2026-09-29T11:47:00Z' },

  // ─── dimension reporting (4) ───
  { id: 'r07a', title: 'Revenue breakdown by product line', bodyRaw: 'They require a split of revenue by product line in reports.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'vantage-foods', createdAt: '2026-08-12T09:20:00Z' },
  { id: 'r07b', title: 'The board asked a question I could not answer', bodyRaw: 'Our investors wondered which parts of the business are growing. Pulling that apart cost me a week in spreadsheets.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'kestrel', createdAt: '2026-08-28T13:11:00Z' },
  { id: 'r07c', title: 'Filter reports by location?', bodyRaw: 'Multi-site practice would like per-clinic figures. Not possible currently.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'pinehurst', createdAt: '2026-09-14T10:02:00Z' },
  { id: 'r07d', title: 'Cannot see which routes make money', bodyRaw: 'Everything arrives as one lump. We slice it externally.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'brightline', createdAt: '2026-09-30T15:25:00Z' },

  // ─── bulk edit (4) ───
  { id: 'r08a', title: 'Bulk edit invoices', bodyRaw: 'We would like to select many invoices and change them together.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'summit-freight', createdAt: '2026-08-13T11:33:00Z' },
  { id: 'r08b', title: 'One at a time is painful', bodyRaw: 'Caller spent an afternoon opening each record individually to fix a single field.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'fernwood', createdAt: '2026-08-31T14:49:00Z' },
  { id: 'r08c', title: 'Mass update of due dates', bodyRaw: 'After a rate change I had to touch two hundred lines by hand.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'tideline', createdAt: '2026-09-16T09:58:00Z' },
  { id: 'r08d', title: 'No multi-select anywhere', bodyRaw: 'Checkboxes would save me hours.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'alder-coffee', createdAt: '2026-10-01T12:40:00Z' },

  // ─── offline approval (3) ───
  { id: 'r09a', title: 'Approvers will not log in', bodyRaw: 'Their CFO signs off from email while travelling and refuses to open another tool.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'northwind', createdAt: '2026-08-17T10:12:00Z' },
  { id: 'r09b', title: 'Approve from my phone', bodyRaw: 'I am rarely at a desk during clinic hours.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'pinehurst', createdAt: '2026-09-07T16:55:00Z' },
  { id: 'r09c', title: 'Approval latency is a churn signal', bodyRaw: 'Deals stall when the approver is on the road.', submitterKind: 'internal', source: 'internal', createdAt: '2026-10-02T09:05:00Z' },

  // ─── safe testing (3) ───
  { id: 'r10a', title: 'Sandbox environment please', bodyRaw: 'They would like a sandbox so pricing changes can be tested.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'orchard-labs', createdAt: '2026-08-25T11:18:00Z' },
  { id: 'r10b', title: 'We broke live billing last week', bodyRaw: 'There is nowhere safe to try a new rate card, so somebody edited production and real clients received wrong amounts.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'summit-freight', createdAt: '2026-09-21T13:44:00Z' },
  { id: 'r10c', title: 'No staging for billing logic', bodyRaw: 'Engineering cannot verify a migration without touching customer data.', submitterKind: 'internal', source: 'internal', createdAt: '2026-10-03T10:28:00Z' },

  // ─── alert scoping (9) — the popular, low-value problem ───
  { id: 'r11a', title: 'Too many emails', bodyRaw: 'I receive a notification for every invoice event. Give me a filter.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'alder-coffee', createdAt: '2026-07-27T08:30:00Z' },
  { id: 'r11b', title: 'Inbox is unusable so I switched them off', bodyRaw: 'There is no route to narrow what reaches my team, so the whole lot went silent and now important items slip past.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'bellweather', createdAt: '2026-08-02T09:15:00Z' },
  { id: 'r11c', title: 'Can I turn off payment alerts only?', bodyRaw: 'Wants granular control. Currently all-or-nothing.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'cobbler-sons', createdAt: '2026-08-09T11:22:00Z' },
  { id: 'r11d', title: 'Notification settings are all or nothing', bodyRaw: 'Either everything or silence. Nothing in between.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'dunmore', createdAt: '2026-08-16T13:08:00Z' },
  { id: 'r11e', title: 'I miss the ones that matter', bodyRaw: 'Important alerts are buried under routine ones.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'evergreen', createdAt: '2026-08-23T15:35:00Z' },
  { id: 'r11f', title: 'Mute weekends', bodyRaw: 'I do not require pings on a Sunday.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'fiddlehead', createdAt: '2026-09-06T10:44:00Z' },
  { id: 'r11g', title: 'Email volume complaint', bodyRaw: 'Caller receives dozens a day and requested we stop them entirely.', submitterKind: 'support', source: 'support_ticket', accountSlug: 'hollow-pine', createdAt: '2026-09-13T12:02:00Z' },
  { id: 'r11h', title: 'Digest instead of individual emails', bodyRaw: 'One summary a day would be plenty.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'ironwood', createdAt: '2026-09-24T09:37:00Z' },
  { id: 'r11i', title: 'Alerts for my accounts only', bodyRaw: 'I observe events for the whole organisation, not just the clients I own.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'juniper-yoga', createdAt: '2026-10-04T14:11:00Z' },

  // ─── data residency (3) — few voices, large money, clear strategy link ───
  { id: 'r12a', title: 'EU data residency required', bodyRaw: 'Procurement requires their data to be hosted in the EU before renewal.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'northwind', createdAt: '2026-08-30T10:50:00Z' },
  { id: 'r12b', title: 'Legal blocked the rollout', bodyRaw: 'Our counsel will not permit information about German staff to leave the country. Until that is possible we cannot expand the contract.', submitterKind: 'customer', source: 'customer_direct', accountSlug: 'calder-health', createdAt: '2026-09-19T16:20:00Z' },
  { id: 'r12c', title: 'Hosting location came up in the security review', bodyRaw: 'Their CISO enquired where records physically sit. Flagged as a renewal risk on a €410k account.', submitterKind: 'customer', source: 'csm_note', accountSlug: 'brightline', createdAt: '2026-10-05T11:15:00Z' },
];

/**
 * The scripted demo request. NOT seeded — it is typed live in the demo so a
 * reviewer watches dedupe happen in real time. It paraphrases the ledger-sync
 * problem with zero content words in common with any of its seven requests,
 * which seed.test.ts verifies.
 */
export const DEMO_REQUEST = {
  title: 'Closing the books means a week of retyping',
  bodyRaw:
    'Every period my controller transcribes each total into Sage by hand. It eats most of a week and she has caught several slips after the fact.',
  submitterKind: 'customer' as const,
  source: 'customer_direct' as const,
  accountSlug: 'pinehurst',
};

export const requestIdFor = (id: string) => `req-${id}`;
