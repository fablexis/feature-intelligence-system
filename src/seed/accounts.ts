/**
 * Ledgerline's customer base. Segment and ARR are the inputs C5 reads for the
 * `customer_value` factor — see config/strategy.json for the company itself.
 *
 * The ARR spread is load-bearing for the demo: the problem with the most
 * distinct accounts is deliberately made of small ones, and the problem that
 * should outrank it is made of three very large ones.
 */
export type SeedAccount = {
  slug: string;
  name: string;
  segment: 'enterprise' | 'mid' | 'smb';
  arrCents: number;
  renewalDate: string | null;
  /** Not yet a customer; files through an AE. ARR is 0 by definition. */
  prospect?: true;
};

const m = (dollars: number) => dollars * 100;

export const SEED_ACCOUNTS: SeedAccount[] = [
  // Enterprise — the strategic weight in the corpus
  { slug: 'northwind', name: 'Northwind Logistics', segment: 'enterprise', arrCents: m(640_000), renewalDate: '2027-01-31' },
  { slug: 'calder-health', name: 'Calder Health Systems', segment: 'enterprise', arrCents: m(520_000), renewalDate: '2026-12-31' },
  { slug: 'brightline', name: 'Brightline Rail', segment: 'enterprise', arrCents: m(410_000), renewalDate: '2027-03-31' },
  { slug: 'vantage-foods', name: 'Vantage Foods Group', segment: 'enterprise', arrCents: m(335_000), renewalDate: '2027-02-28' },
  { slug: 'harbor-grey', name: 'Harbor & Grey LLP', segment: 'enterprise', arrCents: m(281_000), renewalDate: '2026-11-30' },

  // Mid-market
  { slug: 'pinehurst', name: 'Pinehurst Dental Group', segment: 'mid', arrCents: m(138_000), renewalDate: '2027-04-30' },
  { slug: 'kestrel', name: 'Kestrel Media', segment: 'mid', arrCents: m(104_000), renewalDate: '2027-01-15' },
  { slug: 'orchard-labs', name: 'Orchard Labs', segment: 'mid', arrCents: m(92_000), renewalDate: '2026-12-15' },
  { slug: 'summit-freight', name: 'Summit Freight', segment: 'mid', arrCents: m(76_000), renewalDate: '2027-05-31' },
  { slug: 'tideline', name: 'Tideline Marine', segment: 'mid', arrCents: m(61_000), renewalDate: '2027-02-15' },
  { slug: 'fernwood', name: 'Fernwood Living', segment: 'mid', arrCents: m(44_000), renewalDate: '2027-06-30' },

  // SMB — many voices, little money
  { slug: 'alder-coffee', name: 'Alder Coffee Roasters', segment: 'smb', arrCents: m(29_000), renewalDate: '2027-03-15' },
  { slug: 'bellweather', name: 'Bellweather Studio', segment: 'smb', arrCents: m(24_000), renewalDate: '2027-01-20' },
  { slug: 'cobbler-sons', name: 'Cobbler & Sons', segment: 'smb', arrCents: m(21_000), renewalDate: '2026-12-20' },
  { slug: 'dunmore', name: 'Dunmore Cycles', segment: 'smb', arrCents: m(18_000), renewalDate: '2027-04-10' },
  { slug: 'evergreen', name: 'Evergreen Tutors', segment: 'smb', arrCents: m(16_000), renewalDate: '2027-05-01' },
  { slug: 'fiddlehead', name: 'Fiddlehead Farm', segment: 'smb', arrCents: m(14_000), renewalDate: '2027-02-01' },
  { slug: 'gaslight', name: 'Gaslight Books', segment: 'smb', arrCents: m(12_000), renewalDate: '2027-07-31' },
  { slug: 'hollow-pine', name: 'Hollow Pine Pottery', segment: 'smb', arrCents: m(11_000), renewalDate: '2027-03-01' },
  { slug: 'ironwood', name: 'Ironwood Joinery', segment: 'smb', arrCents: m(9_000), renewalDate: '2027-06-15' },
  { slug: 'juniper-yoga', name: 'Juniper Yoga', segment: 'smb', arrCents: m(8_000), renewalDate: '2027-01-10' },

  // Prospect — in the pipeline, no contract yet
  { slug: 'meridian-freight', name: 'Meridian Freight', segment: 'enterprise', arrCents: 0, renewalDate: null, prospect: true },
];

export const accountIdFor = (slug: string) => `acc-${slug}`;
