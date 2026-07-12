import type { WrenTool } from '@wren/core';

/**
 * Ten demo tools against the TaskFlow fixture corpus's domain, enough to
 * run the tool-count sweep (3, 5, 7, 10) without reusing a tool across
 * sweep sizes. None of these touch real data; execute() just echoes back
 * enough to prove which tool and args Nano chose.
 */
export const EVAL_TOOLS: readonly WrenTool[] = [
  {
    name: 'create_task',
    description: 'Creates a new task with a title and an optional project name.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string' }, project: { type: 'string' } },
    },
    execute: async (args) => ({ content: `Created task "${String(args.title)}"` }),
  },
  {
    name: 'search_tasks',
    description: 'Searches existing tasks by keyword.',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    execute: async (args) => ({ content: `Found 0 tasks matching "${String(args.query)}"` }),
  },
  {
    name: 'get_current_user',
    description: "Returns the signed-in user's name and role.",
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'Signed in as Jordan Lee (Admin)' }),
  },
  {
    name: 'assign_task',
    description: 'Assigns an existing task, identified by title, to a teammate by name.',
    inputSchema: {
      type: 'object',
      required: ['taskTitle', 'assignee'],
      properties: { taskTitle: { type: 'string' }, assignee: { type: 'string' } },
    },
    execute: async (args) => ({ content: `Assigned "${String(args.taskTitle)}" to ${String(args.assignee)}` }),
  },
  {
    name: 'list_team_members',
    description: "Lists everyone on the caller's team.",
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'Jordan Lee, Priya Nair, Sam Osei' }),
  },
  {
    name: 'get_billing_plan',
    description: "Returns the team's current billing plan.",
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'Team plan, 4 seats' }),
  },
  {
    name: 'set_task_due_date',
    description: 'Sets the due date on an existing task, identified by title.',
    inputSchema: {
      type: 'object',
      required: ['taskTitle', 'dueDate'],
      properties: { taskTitle: { type: 'string' }, dueDate: { type: 'string' } },
    },
    execute: async (args) => ({ content: `Set due date for "${String(args.taskTitle)}" to ${String(args.dueDate)}` }),
  },
  {
    name: 'get_project_summary',
    description: 'Returns a short status summary for a project by name.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' } } },
    execute: async (args) => ({ content: `${String(args.project)}: 12 open tasks, 3 overdue` }),
  },
  {
    name: 'create_label',
    description: 'Creates a new label with a name and color.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, color: { type: 'string' } },
    },
    execute: async (args) => ({ content: `Created label "${String(args.name)}"` }),
  },
  {
    name: 'archive_project',
    description: 'Archives a project by name, hiding it from the active project list.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' } } },
    execute: async (args) => ({ content: `Archived project "${String(args.project)}"` }),
  },
];
