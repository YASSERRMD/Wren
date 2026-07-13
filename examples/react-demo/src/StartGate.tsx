import { useState } from 'react';
import { WrenProvider } from '@wren/react';
import { App } from './App.js';

/**
 * Chrome's Prompt API requires a user gesture to start a Nano model
 * download (LanguageModel.create() rejects with "Requires a user
 * gesture..." otherwise, confirmed empirically): WrenProvider creates
 * Wren automatically on mount, so it cannot itself be the gesture.
 * Gating it behind this click is what makes that automatic
 * initialisation satisfy the browser's requirement.
 */
export function StartGate(): React.JSX.Element {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <main>
        <h1>Neighborhood Futures Fund: Micro-Grant Application</h1>
        <p>
          A form-filling copilot built on Wren. Everything, including any Nano model
          download, runs in this browser tab; nothing is sent anywhere else.
        </p>
        <button onClick={() => setStarted(true)}>Start</button>
      </main>
    );
  }

  return (
    <WrenProvider dbName="wren-react-demo.sqlite3">
      <App />
    </WrenProvider>
  );
}
