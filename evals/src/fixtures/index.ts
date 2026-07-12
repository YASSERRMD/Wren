import type { WrenSource } from '@wren/core';
import gettingStarted from './getting-started.md?raw';
import managingTasks from './managing-tasks.md?raw';
import teamPermissions from './team-permissions.md?raw';
import billingPlans from './billing-plans.md?raw';
import troubleshootingFaq from './troubleshooting-faq.md?raw';

/**
 * A small, fixed documentation corpus for a fictional project management
 * product, TaskFlow, committed to the repo so eval runs are comparable
 * over time. `managing-tasks` nests six heading levels deep (Managing
 * Tasks > Task basics > Subtasks > Recurring subtasks > Recurring
 * subtask templates > Advanced template rules) specifically to exercise
 * depth clamping against MAX_SECTION_DEPTH.
 */
export const FIXTURE_DOCUMENTS: readonly WrenSource[] = [
  { type: 'markdown', title: 'Getting Started with TaskFlow', content: gettingStarted },
  { type: 'markdown', title: 'Managing Tasks', content: managingTasks },
  { type: 'markdown', title: 'Team and Permissions', content: teamPermissions },
  { type: 'markdown', title: 'Billing and Plans', content: billingPlans },
  { type: 'markdown', title: 'Troubleshooting and FAQ', content: troubleshootingFaq },
];
