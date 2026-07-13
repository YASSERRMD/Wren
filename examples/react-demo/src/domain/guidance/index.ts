import type { WrenSource } from '@wren/core';
import eligibility from './eligibility.md?raw';
import fundingTiers from './funding-tiers.md?raw';
import categories from './categories.md?raw';

/** The guidance notes for the grant application form, ingested once at startup. */
export const GUIDANCE_DOCUMENTS: readonly WrenSource[] = [
  { type: 'markdown', title: 'Eligibility', content: eligibility },
  { type: 'markdown', title: 'Funding Tiers', content: fundingTiers },
  { type: 'markdown', title: 'Project Categories', content: categories },
];
