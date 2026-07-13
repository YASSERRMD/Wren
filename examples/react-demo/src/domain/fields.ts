export type FieldType = 'text' | 'number' | 'select' | 'textarea';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  name: string;
  label: string;
  type: FieldType;
  options?: readonly SelectOption[];
}

export interface FormSection {
  id: string;
  title: string;
  fields: readonly FieldDefinition[];
}

export const FORM_SECTIONS: readonly FormSection[] = [
  {
    id: 'applicant',
    title: 'Applicant Information',
    fields: [
      { name: 'orgName', label: 'Organization name', type: 'text' },
      {
        name: 'orgType',
        label: 'Organization type',
        type: 'select',
        options: [
          { value: 'nonprofit', label: 'Registered nonprofit' },
          { value: 'school', label: 'School' },
          { value: 'community_group', label: 'Informal community group' },
          { value: 'local_government', label: 'Local government office' },
        ],
      },
      { name: 'contactEmail', label: 'Contact email', type: 'text' },
      { name: 'yearsOperating', label: 'Years operating', type: 'number' },
    ],
  },
  {
    id: 'eligibility',
    title: 'Eligibility Screening',
    fields: [
      { name: 'annualBudget', label: 'Annual operating budget (USD)', type: 'number' },
      {
        name: 'priorGrantsFromFund',
        label: 'Prior grants received from this fund',
        type: 'select',
        options: [
          { value: 'none', label: 'None' },
          { value: 'one', label: 'One' },
          { value: 'two_or_more', label: 'Two or more' },
        ],
      },
      {
        name: 'serviceArea',
        label: 'Service area',
        type: 'select',
        options: [
          { value: 'riverside', label: 'Riverside' },
          { value: 'downtown', label: 'Downtown' },
          { value: 'eastside', label: 'Eastside' },
          { value: 'countywide', label: 'Countywide' },
        ],
      },
    ],
  },
  {
    id: 'project',
    title: 'Project Details',
    fields: [
      {
        name: 'projectCategory',
        label: 'Project category',
        type: 'select',
        options: [
          { value: 'youth_programs', label: 'Youth Programs' },
          { value: 'environmental', label: 'Environmental' },
          { value: 'arts_culture', label: 'Arts and Culture' },
          { value: 'food_security', label: 'Food Security' },
          { value: 'emergency_relief', label: 'Emergency Relief' },
        ],
      },
      { name: 'fundingAmountRequested', label: 'Funding amount requested (USD)', type: 'number' },
      { name: 'projectDescription', label: 'Project description', type: 'textarea' },
    ],
  },
  {
    id: 'impact',
    title: 'Community Impact',
    fields: [
      { name: 'populationServed', label: 'Estimated people served', type: 'number' },
      { name: 'impactStatement', label: 'Impact statement', type: 'textarea' },
    ],
  },
];

export const ALL_FIELDS: readonly FieldDefinition[] = FORM_SECTIONS.flatMap((section) => section.fields);

export function findField(name: string): FieldDefinition | undefined {
  return ALL_FIELDS.find((field) => field.name === name);
}
