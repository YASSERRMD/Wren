import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StartGate } from './StartGate.js';
import './style.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <StartGate />
  </StrictMode>,
);
