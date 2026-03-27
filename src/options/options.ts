import { NOTION_DEFAULTS } from '../lib/constants';
import type { NotionConfig } from '../lib/types';

const STORAGE_KEY = 'claudeAnnotator';

async function init() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const storage = data[STORAGE_KEY] ?? {};
  const config: Partial<NotionConfig> = storage.notionConfig ?? {};

  (document.getElementById('apiKey') as HTMLInputElement).value = config.apiKey ?? '';
  (document.getElementById('sessionsDbId') as HTMLInputElement).value = config.sessionsDbId ?? NOTION_DEFAULTS.sessionsDbId;
  (document.getElementById('annotationsDbId') as HTMLInputElement).value = config.annotationsDbId ?? NOTION_DEFAULTS.annotationsDbId;
  (document.getElementById('sessionsDsId') as HTMLInputElement).value = config.sessionsDsId ?? NOTION_DEFAULTS.sessionsDsId;
  (document.getElementById('annotationsDsId') as HTMLInputElement).value = config.annotationsDsId ?? NOTION_DEFAULTS.annotationsDsId;
  (document.getElementById('defaultProject') as HTMLSelectElement).value = storage.defaultProject ?? 'personal';
  (document.getElementById('defaultAutoPin') as HTMLInputElement).checked = storage.defaultAutoPin === true;

  document.getElementById('save')!.addEventListener('click', saveSettings);
  document.getElementById('test')!.addEventListener('click', testConnection);
}

async function saveSettings() {
  const config: NotionConfig = {
    apiKey: (document.getElementById('apiKey') as HTMLInputElement).value.trim(),
    sessionsDbId: (document.getElementById('sessionsDbId') as HTMLInputElement).value.trim(),
    annotationsDbId: (document.getElementById('annotationsDbId') as HTMLInputElement).value.trim(),
    sessionsDsId: (document.getElementById('sessionsDsId') as HTMLInputElement).value.trim(),
    annotationsDsId: (document.getElementById('annotationsDsId') as HTMLInputElement).value.trim(),
  };

  const defaultProject = (document.getElementById('defaultProject') as HTMLSelectElement).value;
  const defaultAutoPin = (document.getElementById('defaultAutoPin') as HTMLInputElement).checked;

  const data = await chrome.storage.local.get(STORAGE_KEY);
  const storage = data[STORAGE_KEY] ?? { sessions: {}, recentTags: [] };
  storage.notionConfig = config;
  storage.defaultProject = defaultProject;
  storage.defaultAutoPin = defaultAutoPin;

  await chrome.storage.local.set({ [STORAGE_KEY]: storage });
  showMessage('Settings saved!', 'success');
}

async function testConnection() {
  const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
  if (!apiKey) {
    showMessage('Please enter an API key first.', 'error');
    return;
  }

  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (res.ok) {
      const user = await res.json();
      showMessage(`Connected! Authenticated as: ${user.name ?? user.bot?.owner?.user?.name ?? 'Integration'}`, 'success');
    } else {
      const err = await res.text();
      showMessage(`Connection failed (${res.status}): ${err}`, 'error');
    }
  } catch (err) {
    showMessage(`Connection error: ${err}`, 'error');
  }
}

function showMessage(text: string, type: 'success' | 'error') {
  const el = document.getElementById('message')!;
  el.textContent = text;
  el.className = `message ${type}`;
}

init();
