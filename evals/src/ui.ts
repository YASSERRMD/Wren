const statusEl = document.querySelector<HTMLDivElement>('#status');
const resultsEl = document.querySelector<HTMLDivElement>('#results');
const runButton = document.querySelector<HTMLButtonElement>('#run');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');

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
      if (downloadButton) downloadButton.hidden = true;
      try {
        await handler();
      } finally {
        if (runButton) runButton.disabled = false;
      }
    })();
  });
}

/** Reveals the download button and wires it to produce this run's report; replaces any previous run's handler. */
export function showDownloadButton(onDownload: () => void): void {
  if (!downloadButton) return;
  downloadButton.hidden = false;
  downloadButton.onclick = onDownload;
}
