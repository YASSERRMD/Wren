import { useCallback, useMemo, useRef, useState } from 'react';
import { useTool, useWren } from '@wren/react';
import type { Citation } from '@wren/core';
import { ALL_FIELDS, FORM_SECTIONS } from './fields.js';
import { createFormTools } from './tools.js';

export interface FieldExplanation {
  citations: Citation[];
  note: string | undefined;
}

const MAX_COPILOT_STEPS = ALL_FIELDS.length + 2;
/**
 * A single unproductive step (nothing extracted, or a rejected tool call)
 * is tolerated rather than ending the run: against a real on-device model,
 * one low-confidence "none"/wrong-field response does not reliably mean
 * there is nothing left to extract (see the linked accuracy issue). Giving
 * up only after two in a row is what the existing MAX_COPILOT_STEPS "+2"
 * headroom was already sized for; previously nothing used that headroom,
 * since the loop bailed on the very first unproductive step.
 */
const MAX_CONSECUTIVE_MISSES = 2;

export function useFormCopilot() {
  const { wren, status } = useWren();
  const [values, setValues] = useState<Record<string, string>>({});
  const [explanations, setExplanations] = useState<Record<string, FieldExplanation>>({});
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const valuesRef = useRef(values);
  valuesRef.current = values;

  const setValue = useCallback((field: string, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const validateSection = useCallback((sectionId: string) => {
    const section = FORM_SECTIONS.find((s) => s.id === sectionId);
    if (!section) return { valid: false, issues: [`Unknown section "${sectionId}"`] };
    const issues = section.fields.filter((f) => !valuesRef.current[f.name]?.trim()).map((f) => `${f.label} is empty`);
    return { valid: issues.length === 0, issues };
  }, []);

  const tools = useMemo(() => createFormTools({ setValue, validateSection }), [setValue, validateSection]);
  useTool(tools[0]);
  useTool(tools[1]);
  useTool(tools[2]);
  useTool(tools[3]);

  const appendLog = useCallback((message: string) => setLog((prev) => [...prev, message]), []);

  const runCopilot = useCallback(
    async (prose: string) => {
      if (!wren || status !== 'ready') return;
      setRunning(true);
      setLog([]);
      let lastApplied: string | undefined;
      let consecutiveMisses = 0;
      // Local to this run and updated synchronously the instant a tool call
      // succeeds, rather than read back through React state: setValues()
      // only takes effect once this component next re-renders, which is not
      // guaranteed to have happened yet by the very next loop iteration.
      const filled = { ...valuesRef.current };

      try {
        for (let step = 0; step < MAX_COPILOT_STEPS; step += 1) {
          const emptyFields = ALL_FIELDS.filter((f) => !filled[f.name]?.trim()).map((f) => f.name);
          if (emptyFields.length === 0) {
            appendLog('All fields filled.');
            break;
          }

          const prompt = `The applicant described their situation as: "${prose}"\n\nStill-empty form fields: ${emptyFields.join(', ')}.\nFill in exactly one still-empty field that can be determined from what the applicant said, using fill_field or select_option. If nothing more can be determined from what they said, say so instead of calling a tool.`;
          const response = await wren.query(prompt);

          if (response.action !== 'tool') {
            appendLog(response.answer);
            consecutiveMisses += 1;
            if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
              appendLog('Stopped: nothing more could be determined from what was said.');
              break;
            }
            continue;
          }

          if (response.toolCall?.isError) {
            appendLog(`Not applied: ${response.toolCall.result}`);
            consecutiveMisses += 1;
            if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
              appendLog('Stopped: nothing more could be determined from what was said.');
              break;
            }
            continue;
          }

          const appliedField = String(response.toolCall?.args.field ?? '');
          const appliedValue = String(response.toolCall?.args.value ?? response.toolCall?.args.option ?? '');
          const signature = `${appliedField}=${appliedValue}`;
          appendLog(response.answer);

          if (signature === lastApplied) {
            appendLog('Stopped: the copilot repeated the same field, nothing more to extract.');
            break;
          }
          lastApplied = signature;
          consecutiveMisses = 0;
          if (appliedField) filled[appliedField] = appliedValue;

          if (appliedField) {
            const citationResponse = await wren.query(`What guidance explains the "${appliedField}" field?`);
            setExplanations((prev) => ({
              ...prev,
              [appliedField]: { citations: citationResponse.citations, note: citationResponse.answer },
            }));
          }
        }
      } finally {
        setRunning(false);
      }
    },
    [wren, status, appendLog],
  );

  return { values, setValue, explanations, running, log, runCopilot };
}
