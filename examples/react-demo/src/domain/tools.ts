import type { WrenTool } from '@wren/core';
import { findField } from './fields.js';

const FIELD_EXPLANATIONS: Record<string, string> = {
  orgName: 'The legal or commonly-used name of the applying organization.',
  orgType: 'Nonprofit, school, informal community group, or local government office. Informal groups need at least six months of activity to be eligible.',
  contactEmail: 'An email address the fund can reach for questions about this application.',
  yearsOperating: 'How many years the organization has been operating, used to check eligibility for the large-grant tier (requires at least two years).',
  annualBudget: "The organization's total operating budget for its most recent fiscal year, in US dollars. Determines which funding tier applies.",
  priorGrantsFromFund: 'How many grants this organization has previously received from this fund. Two or more triggers a twelve-month cooldown before reapplying.',
  serviceArea: 'Which part of the fund\'s service area the project serves. Choose Countywide only for a project that genuinely serves multiple areas.',
  projectCategory: 'The closest matching category for the project: Youth Programs, Environmental, Arts and Culture, Food Security, or Emergency Relief.',
  fundingAmountRequested: 'How much funding is being requested, in US dollars. Determines which tier (small, standard, large) the request falls into.',
  projectDescription: 'A description of what the project will actually do.',
  populationServed: 'An estimate of how many people the project will reach or serve.',
  impactStatement: 'A short statement of the expected community impact of the project.',
};

export interface FormToolsDeps {
  setValue: (field: string, value: string) => void;
  validateSection: (sectionId: string) => { valid: boolean; issues: string[] };
}

/** The four tools registered via useTool, matching the exact names and shapes the pack specifies. */
export function createFormTools(deps: FormToolsDeps): WrenTool[] {
  return [
    {
      name: 'fill_field',
      description: 'Fills a text or number field on the grant application form. Not for select fields; use select_option for those.',
      inputSchema: {
        type: 'object',
        required: ['field', 'value'],
        properties: { field: { type: 'string' }, value: { type: 'string' } },
      },
      execute: async (args) => {
        const field = findField(String(args.field));
        if (!field) return { content: `Unknown field "${String(args.field)}"`, isError: true };
        if (field.type === 'select') {
          return { content: `"${field.name}" is a select field; use select_option instead.`, isError: true };
        }
        deps.setValue(field.name, String(args.value));
        return { content: `Filled "${field.label}" with "${String(args.value)}"` };
      },
    },
    {
      name: 'select_option',
      description: 'Chooses an option for a select field: organization type, prior grants, service area, or project category.',
      inputSchema: {
        type: 'object',
        required: ['field', 'option'],
        properties: { field: { type: 'string' }, option: { type: 'string' } },
      },
      execute: async (args) => {
        const field = findField(String(args.field));
        if (!field || field.type !== 'select' || !field.options) {
          return { content: `"${String(args.field)}" is not a select field`, isError: true };
        }
        const requested = String(args.option).toLowerCase();
        const option = field.options.find((o) => o.value === requested || o.label.toLowerCase() === requested);
        if (!option) {
          const valid = field.options.map((o) => o.label).join(', ');
          return { content: `"${String(args.option)}" is not a valid option for "${field.label}". Valid options: ${valid}`, isError: true };
        }
        deps.setValue(field.name, option.value);
        return { content: `Set "${field.label}" to "${option.label}"` };
      },
    },
    {
      name: 'explain_field',
      description: 'Explains what a specific form field means or expects, in plain language.',
      inputSchema: { type: 'object', required: ['field'], properties: { field: { type: 'string' } } },
      execute: async (args) => {
        const field = findField(String(args.field));
        if (!field) return { content: `Unknown field "${String(args.field)}"`, isError: true };
        return { content: FIELD_EXPLANATIONS[field.name] ?? field.label };
      },
    },
    {
      name: 'validate_section',
      description: 'Checks whether a form section (applicant, eligibility, project, impact) is complete.',
      inputSchema: { type: 'object', required: ['section'], properties: { section: { type: 'string' } } },
      execute: async (args) => {
        const result = deps.validateSection(String(args.section));
        return { content: result.valid ? 'This section is complete.' : `Incomplete: ${result.issues.join('; ')}` };
      },
    },
  ];
}
