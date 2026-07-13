import { useEffect, useRef, useState } from 'react';
import { useIngest, useWren } from '@wren/react';
import { FORM_SECTIONS } from './domain/fields.js';
import { GUIDANCE_DOCUMENTS } from './domain/guidance/index.js';
import { useFormCopilot } from './domain/useFormCopilot.js';

function useIngestGuidanceOnce(): { ready: boolean; error: Error | null } {
  const { status } = useWren();
  const { ingest, error } = useIngest();
  const startedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      for (const source of GUIDANCE_DOCUMENTS) {
        await ingest(source);
      }
      setReady(true);
    })();
  }, [status, ingest]);

  return { ready, error };
}

function DegradedState({ reason }: { reason: string }): React.JSX.Element {
  return (
    <div className="degraded">
      <h2>This browser cannot run the copilot</h2>
      <p>{reason}</p>
      <p>The form below still works; you can fill it in by hand.</p>
    </div>
  );
}

export function App(): React.JSX.Element {
  const { status, error: wrenError } = useWren();
  const { ready: guidanceReady, error: ingestError } = useIngestGuidanceOnce();
  const { values, setValue, explanations, running, log, runCopilot } = useFormCopilot();
  const [prose, setProse] = useState('');

  const copilotAvailable = status === 'ready' && guidanceReady;

  return (
    <main>
      <h1>Neighborhood Futures Fund: Micro-Grant Application</h1>
      <p>
        Describe your organization and project in your own words, and the copilot fills in
        what it can from the fund's guidance notes, citing which page drove each answer.
      </p>

      {status === 'initialising' && <DegradedState reason="Starting Wren..." />}
      {status === 'unsupported' && (
        <DegradedState reason="This browser does not support the storage Wren needs (OPFS and Web Workers)." />
      )}
      {status === 'error' && <DegradedState reason={`Wren failed to start: ${wrenError?.message ?? 'unknown error'}`} />}
      {ingestError && <DegradedState reason={`Could not load the guidance notes: ${ingestError.message}`} />}

      <section className="copilot">
        <textarea
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          placeholder="e.g. We're Riverside Youth Mentors, a nonprofit that's been running for 3 years. Our annual budget is about $150,000. We're applying for $8,000 for after-school equipment and expect to reach 200 kids this year. We haven't received funding from this fund before."
          rows={4}
          disabled={!copilotAvailable}
        />
        <button onClick={() => void runCopilot(prose)} disabled={!copilotAvailable || running || !prose.trim()}>
          {running ? 'Filling form...' : 'Fill form'}
        </button>
        {!copilotAvailable && status === 'ready' && <p>Loading guidance notes...</p>}
        {log.length > 0 && (
          <ul className="copilot-log">
            {log.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ul>
        )}
      </section>

      {FORM_SECTIONS.map((section) => (
        <section key={section.id} className="form-section">
          <h2>{section.title}</h2>
          {section.fields.map((field) => {
            const explanation = explanations[field.name];
            return (
              <div key={field.name} className="field">
                <label htmlFor={field.name}>{field.label}</label>
                {field.type === 'select' ? (
                  <select
                    id={field.name}
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValue(field.name, e.target.value)}
                  >
                    <option value="">(not set)</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    id={field.name}
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValue(field.name, e.target.value)}
                    rows={2}
                  />
                ) : (
                  <input
                    id={field.name}
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValue(field.name, e.target.value)}
                  />
                )}
                {explanation && explanation.citations.length > 0 && (
                  <p className="citation">
                    From: {explanation.citations.map((c) => c.heading).join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </main>
  );
}
