const statusEl = document.querySelector<HTMLDivElement>('#status');
const resultsEl = document.querySelector<HTMLDivElement>('#results');
const runButton = document.querySelector<HTMLButtonElement>('#run');

export function log(message: string): void {
  if (!statusEl) return;
  statusEl.textContent += `${message}\n`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

export function clearLog(): void {
  if (statusEl) statusEl.textContent = '';
}

export function setResultsHtml(html: string): void {
  if (resultsEl) resultsEl.innerHTML = html;
}

export function onRunClick(handler: () => Promise<void>): void {
  runButton?.addEventListener('click', () => {
    void (async () => {
      if (runButton) runButton.disabled = true;
      try {
        await handler();
      } finally {
        if (runButton) runButton.disabled = false;
      }
    })();
  });
}
