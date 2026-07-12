export type EvalCategory = 'answer' | 'tool' | 'navigate' | 'none' | 'fts-operator' | 'near-miss';

export interface EvalCase {
  id: string;
  category: EvalCategory;
  query: string;
  expectedAction: 'answer' | 'tool' | 'none';
  /**
   * Compared against response.citations[].heading, not section ids:
   * ids are freshly generated on every ingest, so nothing stable to
   * hardcode ahead of time. A case passes retrieval if at least one
   * expected heading appears among the citations.
   */
  expectedSectionHeadings?: string[];
  expectedTool?: string;
  /** Compared loosely (case-insensitive substring per key), not exact equality: natural-language argument extraction varies in phrasing even when correct. */
  expectedArgs?: Record<string, string>;
  /** Set on cases that specifically exercise the hop cap; checked against response.hops >= this value. */
  expectMinHops?: number;
}

export const EVAL_CASES: readonly EvalCase[] = [
  // --- straightforward answer retrieval ---
  { id: 'answer-01', category: 'answer', query: 'How do I invite a teammate?', expectedAction: 'answer', expectedSectionHeadings: ['Inviting teammates'] },
  { id: 'answer-02', category: 'answer', query: "What's the difference between Member and Admin roles?", expectedAction: 'answer', expectedSectionHeadings: ['Member permissions', 'Admin permissions'] },
  { id: 'answer-03', category: 'answer', query: "What's included in the Team plan?", expectedAction: 'answer', expectedSectionHeadings: ['Team plan'] },
  { id: 'answer-04', category: 'answer', query: 'What keyboard shortcut creates a task?', expectedAction: 'answer', expectedSectionHeadings: ['Keyboard shortcuts'] },
  { id: 'answer-05', category: 'answer', query: "Why didn't my invite email arrive?", expectedAction: 'answer', expectedSectionHeadings: ["I didn't get my invite email"] },
  { id: 'answer-06', category: 'answer', query: 'Can members delete a project?', expectedAction: 'answer', expectedSectionHeadings: ['Member permissions'] },
  { id: 'answer-07', category: 'answer', query: 'What happens when I cancel my subscription?', expectedAction: 'answer', expectedSectionHeadings: ['Cancelling'] },
  { id: 'answer-08', category: 'answer', query: 'How do I add a subtask?', expectedAction: 'answer', expectedSectionHeadings: ['Subtasks'] },
  { id: 'answer-09', category: 'answer', query: 'What is the default reminder time before a due date?', expectedAction: 'answer', expectedSectionHeadings: ['Due dates and reminders'] },
  { id: 'answer-10', category: 'answer', query: 'How do I create a new label?', expectedAction: 'answer', expectedSectionHeadings: ['Labels'] },
  { id: 'answer-11', category: 'answer', query: 'How do I change a plan?', expectedAction: 'answer', expectedSectionHeadings: ['Changing plans'] },
  { id: 'answer-12', category: 'answer', query: 'What payment methods are accepted?', expectedAction: 'answer', expectedSectionHeadings: ['Payment methods'] },

  // --- tool selection ---
  { id: 'tool-01', category: 'tool', query: 'Create a task called Review Q3 budget', expectedAction: 'tool', expectedTool: 'create_task', expectedArgs: { title: 'Review Q3 budget' } },
  { id: 'tool-02', category: 'tool', query: 'Who is the current logged in user?', expectedAction: 'tool', expectedTool: 'get_current_user' },
  { id: 'tool-03', category: 'tool', query: 'Search for tasks about onboarding', expectedAction: 'tool', expectedTool: 'search_tasks', expectedArgs: { query: 'onboarding' } },
  { id: 'tool-04', category: 'tool', query: 'Assign the design review task to Priya', expectedAction: 'tool', expectedTool: 'assign_task', expectedArgs: { assignee: 'Priya' } },
  { id: 'tool-05', category: 'tool', query: 'List everyone on my team', expectedAction: 'tool', expectedTool: 'list_team_members' },
  { id: 'tool-06', category: 'tool', query: 'What billing plan are we currently on?', expectedAction: 'tool', expectedTool: 'get_billing_plan' },
  { id: 'tool-07', category: 'tool', query: 'Set the due date for the design task to next Friday', expectedAction: 'tool', expectedTool: 'set_task_due_date', expectedArgs: { taskTitle: 'design' } },
  { id: 'tool-08', category: 'tool', query: 'Give me a summary of the Marketing project', expectedAction: 'tool', expectedTool: 'get_project_summary', expectedArgs: { project: 'Marketing' } },
  { id: 'tool-09', category: 'tool', query: 'Create a label called Urgent', expectedAction: 'tool', expectedTool: 'create_label', expectedArgs: { name: 'Urgent' } },
  { id: 'tool-10', category: 'tool', query: 'Archive the Q1 Launch project', expectedAction: 'tool', expectedTool: 'archive_project', expectedArgs: { project: 'Q1 Launch' } },

  // --- needs one navigate hop (deep inside Managing Tasks) ---
  { id: 'navigate-01', category: 'navigate', query: 'What are the advanced rules for recurring subtask templates?', expectedAction: 'answer', expectedSectionHeadings: ['Advanced template rules'], expectMinHops: 1 },
  { id: 'navigate-02', category: 'navigate', query: 'How do recurring subtask template rules handle someone being on vacation?', expectedAction: 'answer', expectedSectionHeadings: ['Advanced template rules'], expectMinHops: 1 },
  { id: 'navigate-03', category: 'navigate', query: 'Tell me about recurring subtasks and how often they repeat', expectedAction: 'answer', expectedSectionHeadings: ['Recurring subtasks'], expectMinHops: 1 },
  { id: 'navigate-04', category: 'navigate', query: 'How do I save a subtask configuration as a reusable template?', expectedAction: 'answer', expectedSectionHeadings: ['Recurring subtask templates'], expectMinHops: 1 },
  { id: 'navigate-05', category: 'navigate', query: 'What exactly is a recurring subtask template, in detail?', expectedAction: 'answer', expectedSectionHeadings: ['Recurring subtask templates'], expectMinHops: 1 },

  // --- no good answer: expect none ---
  { id: 'none-01', category: 'none', query: 'How do I integrate TaskFlow with Slack?', expectedAction: 'none' },
  { id: 'none-02', category: 'none', query: 'Does TaskFlow have a mobile app?', expectedAction: 'none' },
  { id: 'none-03', category: 'none', query: 'Can I export my tasks to a CSV file?', expectedAction: 'none' },
  { id: 'none-04', category: 'none', query: 'What is the boiling point of water?', expectedAction: 'none' },
  { id: 'none-05', category: 'none', query: 'How do I set up single sign-on with Okta?', expectedAction: 'none' },

  // --- FTS5 operator characters in the query text ---
  { id: 'fts-01', category: 'fts-operator', query: '"task" AND "recurring"', expectedAction: 'answer', expectedSectionHeadings: ['Recurring subtasks'] },
  { id: 'fts-02', category: 'fts-operator', query: 'subtask OR template', expectedAction: 'answer', expectedSectionHeadings: ['Subtasks', 'Recurring subtask templates'] },
  { id: 'fts-03', category: 'fts-operator', query: 'billing NOT plan *', expectedAction: 'answer', expectedSectionHeadings: ['Billing and Plans'] },
  { id: 'fts-04', category: 'fts-operator', query: '"team" "permissions" (', expectedAction: 'answer', expectedSectionHeadings: ['Team and Permissions'] },

  // --- near-miss: two sections are both plausible ---
  { id: 'near-01', category: 'near-miss', query: 'How do I remove someone from my team?', expectedAction: 'answer', expectedSectionHeadings: ['Removing a teammate'] },
  { id: 'near-02', category: 'near-miss', query: 'What happens to tasks when I remove a teammate?', expectedAction: 'answer', expectedSectionHeadings: ['Removing a teammate'] },
  { id: 'near-03', category: 'near-miss', query: 'How do labels work in TaskFlow?', expectedAction: 'answer', expectedSectionHeadings: ['Labels'] },
  { id: 'near-04', category: 'near-miss', query: 'What role do I need to change our billing plan?', expectedAction: 'answer', expectedSectionHeadings: ['Changing plans', 'Admin permissions'] },
];
