/**
 * GROUND TRUTH — evaluation only.
 *
 * `scripts/seed.ts` must never import this module. Problems and evidence links
 * in the demo database come into existence *only* by running the intake
 * pipeline over the corpus (C3), so the system is never handed the answers it
 * is being measured on. seed.test.ts enforces the non-import.
 *
 * Labels are opaque keys, not database ids, because the pipeline forms its own
 * problems with its own ids. C7 therefore scores **pairwise**: for every pair
 * of requests, did the pipeline put them together, and should it have?
 */
export const PROBLEM_LABELS = {
  P01_LEDGER_SYNC: 'Finance must re-enter Ledgerline figures into the system of record by hand',
  P02_CHANGE_HISTORY: 'No record of who changed what on an invoice, or when',
  P03_CREDIT_APPROVAL: 'No second signoff before a large credit note or write-off',
  P04_DUNNING_SEGMENTS: 'Collections outreach cannot vary by customer segment',
  P05_FX_AT_CLOSE: 'Foreign-currency totals do not reconcile to the bank at period end',
  P06_IDENTITY_LIFECYCLE: 'User access is provisioned and revoked by hand; no SSO or SCIM',
  P07_DIMENSION_REPORTING: 'Revenue cannot be split by product line or other dimension',
  P08_BULK_EDIT: 'Records can only be changed one at a time',
  P09_OFFLINE_APPROVAL: 'Approvers cannot act without logging into the application',
  P10_SAFE_TESTING: 'No sandbox, so pricing and billing changes are tested in production',
  P11_ALERT_SCOPING: 'Notification volume cannot be scoped, so alerts get muted wholesale',
  P12_DATA_RESIDENCY: 'Data must be hosted in the EU to satisfy procurement and legal',
} as const;

export type ProblemLabel = keyof typeof PROBLEM_LABELS;

/** Every seeded request maps to exactly one problem. */
export const REQUEST_LABELS: Record<string, ProblemLabel> = {
  r01a: 'P01_LEDGER_SYNC', r01b: 'P01_LEDGER_SYNC', r01c: 'P01_LEDGER_SYNC',
  r01d: 'P01_LEDGER_SYNC', r01e: 'P01_LEDGER_SYNC', r01f: 'P01_LEDGER_SYNC',
  r01g: 'P01_LEDGER_SYNC',

  r02a: 'P02_CHANGE_HISTORY', r02b: 'P02_CHANGE_HISTORY', r02c: 'P02_CHANGE_HISTORY',
  r02d: 'P02_CHANGE_HISTORY', r02e: 'P02_CHANGE_HISTORY',

  r03a: 'P03_CREDIT_APPROVAL', r03b: 'P03_CREDIT_APPROVAL', r03c: 'P03_CREDIT_APPROVAL',
  r03d: 'P03_CREDIT_APPROVAL', r03e: 'P03_CREDIT_APPROVAL',

  r04a: 'P04_DUNNING_SEGMENTS', r04b: 'P04_DUNNING_SEGMENTS',
  r04c: 'P04_DUNNING_SEGMENTS', r04d: 'P04_DUNNING_SEGMENTS',

  r05a: 'P05_FX_AT_CLOSE', r05b: 'P05_FX_AT_CLOSE',
  r05c: 'P05_FX_AT_CLOSE', r05d: 'P05_FX_AT_CLOSE',

  r06a: 'P06_IDENTITY_LIFECYCLE', r06b: 'P06_IDENTITY_LIFECYCLE',
  r06c: 'P06_IDENTITY_LIFECYCLE', r06d: 'P06_IDENTITY_LIFECYCLE',

  r07a: 'P07_DIMENSION_REPORTING', r07b: 'P07_DIMENSION_REPORTING',
  r07c: 'P07_DIMENSION_REPORTING', r07d: 'P07_DIMENSION_REPORTING',

  r08a: 'P08_BULK_EDIT', r08b: 'P08_BULK_EDIT',
  r08c: 'P08_BULK_EDIT', r08d: 'P08_BULK_EDIT',

  r09a: 'P09_OFFLINE_APPROVAL', r09b: 'P09_OFFLINE_APPROVAL', r09c: 'P09_OFFLINE_APPROVAL',

  r10a: 'P10_SAFE_TESTING', r10b: 'P10_SAFE_TESTING', r10c: 'P10_SAFE_TESTING',

  r11a: 'P11_ALERT_SCOPING', r11b: 'P11_ALERT_SCOPING', r11c: 'P11_ALERT_SCOPING',
  r11d: 'P11_ALERT_SCOPING', r11e: 'P11_ALERT_SCOPING', r11f: 'P11_ALERT_SCOPING',
  r11g: 'P11_ALERT_SCOPING', r11h: 'P11_ALERT_SCOPING', r11i: 'P11_ALERT_SCOPING',

  r12a: 'P12_DATA_RESIDENCY', r12b: 'P12_DATA_RESIDENCY', r12c: 'P12_DATA_RESIDENCY',
};

/**
 * Planted same-problem pairs with no content word in common. These are the
 * cases the thesis stands on: lexical methods cannot touch them, so they are
 * the recall half of C7's measurement.
 */
export const DISJOINT_PAIRS: Array<[string, string]> = [
  ['r01a', 'r01f'], // "CSV export button" ↔ "copy and paste between tabs"
  ['r02a', 'r02b'], // "who edited this invoice" ↔ "auditors rejected the evidence pack"
  ['r03a', 'r03b'], // "approval step for credit notes" ↔ "anyone can wipe a balance"
  ['r04a', 'r04b'], // "customise dunning per segment" ↔ "chasing everyone the same way"
  ['r05a', 'r05b'], // "wrong exchange rate at close" ↔ "numbers do not match the bank"
  ['r06a', 'r06b'], // "SAML SSO and SCIM" ↔ "offboarding is a security risk"
  ['r07a', 'r07b'], // "revenue by product line" ↔ "the board asked a question"
  ['r08a', 'r08b'], // "bulk edit invoices" ↔ "one at a time is painful"
  ['r10a', 'r10b'], // "sandbox environment" ↔ "we broke live billing"
  ['r11a', 'r11b'], // "too many emails" ↔ "inbox unusable so I switched them off"
  ['r12a', 'r12b'], // "EU data residency" ↔ "legal blocked the rollout"
];

/**
 * Adjacent but genuinely distinct problems. A merge here is a **false merge** —
 * the expensive, near-undetectable error (PRODUCT challenge #3) — so C7 scores
 * these as the precision half of the measurement.
 */
export const RELATED_PAIRS: Array<{ a: string; b: string; why: string }> = [
  {
    a: 'r01a',
    b: 'r07a',
    why: 'Both are "get the data out in a different shape", but one is re-entry into a system of record and the other is in-product dimensional reporting.',
  },
  {
    a: 'r03a',
    b: 'r09a',
    why: 'Both concern approvals. One is whether a control exists at all, the other is where the approver can act from.',
  },
  {
    a: 'r05a',
    b: 'r01b',
    why: 'Both surface at month-end close, but one is an FX conversion defect and the other is a missing integration.',
  },
];

/** The problem the scripted demo request should resolve onto. */
export const DEMO_REQUEST_LABEL: ProblemLabel = 'P01_LEDGER_SYNC';
