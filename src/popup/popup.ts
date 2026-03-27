async function init() {
  // Load stats
  const data = await chrome.storage.local.get('claudeAnnotator');
  const storage = data.claudeAnnotator ?? { sessions: {} };
  const sessions = Object.values(storage.sessions ?? {}) as { annotations: unknown[] }[];
  const totalAnnotations = sessions.reduce((sum, s) => sum + (s.annotations?.length ?? 0), 0);

  document.getElementById('sessionCount')!.textContent = String(sessions.length);
  document.getElementById('annotationCount')!.textContent = String(totalAnnotations);

  // Check Notion config status
  const config = storage.notionConfig;
  const dot = document.getElementById('statusDot')!;
  const text = document.getElementById('statusText')!;

  if (config?.apiKey) {
    dot.className = 'status-dot';
    text.textContent = 'Notion connected';
  } else {
    dot.className = 'status-dot no-config';
    text.textContent = 'Local only — configure Notion in Settings';
  }

  // Check if we're on a claude.ai chat page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('claude.ai/chat/')) {
    dot.className = 'status-dot disconnected';
    text.textContent = 'Not on a Claude.ai chat page';
  }

  // Button handlers
  document.getElementById('toggleSidebar')!.addEventListener('click', async () => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'COMMAND_TOGGLE_SIDEBAR' });
      window.close();
    }
  });

  document.getElementById('exportSession')!.addEventListener('click', async () => {
    if (tab?.id) {
      // Get chat ID from the tab URL
      const match = tab.url?.match(/\/chat\/([a-f0-9-]+)/);
      if (match) {
        chrome.runtime.sendMessage({
          type: 'EXPORT_SESSION',
          payload: { chatId: match[1] },
        }, (response) => {
          if (response?.success && response.data) {
            navigator.clipboard.writeText(response.data as string);
            const btn = document.getElementById('exportSession')!;
            btn.textContent = 'Copied to clipboard!';
            setTimeout(() => { btn.textContent = 'Export Current Session'; }, 2000);
          }
        });
      }
    }
  });

  document.getElementById('openOptions')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  document.getElementById('clearData')?.addEventListener('click', async () => {
    const btn = document.getElementById('clearData')!;
    if (btn.dataset.confirmed !== 'true') {
      btn.textContent = 'are you sure? click again';
      btn.dataset.confirmed = 'true';
      setTimeout(() => {
        btn.textContent = 'clear all data';
        btn.dataset.confirmed = '';
      }, 3000);
      return;
    }
    chrome.runtime.sendMessage({ type: 'CLEAR_ALL_DATA' }, () => {
      btn.textContent = 'cleared!';
      document.getElementById('sessionCount')!.textContent = '0';
      document.getElementById('annotationCount')!.textContent = '0';
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'COMMAND_TOGGLE_SIDEBAR' });
      }
    });
  });
}

init();
