import type { NotionConfig } from '../lib/types';

const STORAGE_KEY = 'claudeAnnotator';

// --- DOM refs ---
const $ = (id: string) => document.getElementById(id)!;
const $input = (id: string) => $(id) as HTMLInputElement;
const $select = (id: string) => $(id) as HTMLSelectElement;

// --- Init ---

async function init() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const storage = data[STORAGE_KEY] ?? {};
  const config: Partial<NotionConfig> = storage.notionConfig ?? {};

  // Load defaults
  $select('defaultProject').value = storage.defaultProject ?? 'personal';
  $input('defaultAutoPin').checked = storage.defaultAutoPin === true;

  // Load manual fields
  $input('sessionsDbId').value = config.sessionsDbId ?? '';
  $input('annotationsDbId').value = config.annotationsDbId ?? '';
  $input('sessionsDsId').value = config.sessionsDsId ?? '';
  $input('annotationsDsId').value = config.annotationsDsId ?? '';

  // Check if already connected
  if (config.apiKey && config.sessionsDbId) {
    showConnected(config.apiKey);
  }

  // Wire up buttons
  $('connect').addEventListener('click', handleConnect);
  $('disconnect').addEventListener('click', handleDisconnect);
  $('saveDefaults').addEventListener('click', saveDefaults);
  $('saveManual').addEventListener('click', saveManualIds);
  $('advancedToggle').addEventListener('click', toggleAdvanced);
}

// --- Auto-setup flow ---

async function handleConnect() {
  const apiKey = $input('apiKey').value.trim();
  if (!apiKey) {
    showNotionMessage('enter an api key first.', 'error');
    return;
  }

  const btn = $('connect') as HTMLButtonElement;
  btn.disabled = true;
  showNotionMessage('<span class="spinner"></span> connecting...', 'info');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SETUP_NOTION',
      payload: { apiKey },
    });

    if (!response.success) {
      showNotionMessage(formatError(response.error), 'error');
      btn.disabled = false;
      return;
    }

    const result = response.data;

    if (result.status === 'connected') {
      // Found existing databases — auto-connected
      showNotionMessage(
        `found existing databases under "${result.parentPageTitle}"`,
        'success',
      );
      showConnected(apiKey);
    } else if (result.status === 'needs_parent') {
      // Show page picker
      showNotionMessage(
        `authenticated as ${result.integrationName}`,
        'success',
      );
      showPagePicker(result.pages, apiKey);
    }
  } catch (err) {
    showNotionMessage(formatError(String(err)), 'error');
  } finally {
    btn.disabled = false;
  }
}

function showPagePicker(
  pages: Array<{ id: string; title: string; icon?: string }>,
  apiKey: string,
) {
  const picker = $('pagePicker');
  const list = $('pageList');
  list.innerHTML = '';

  for (const page of pages) {
    const item = document.createElement('div');
    item.className = 'page-item';
    item.innerHTML = `
      <span class="page-icon">${page.icon ?? '📄'}</span>
      <span class="page-title">${escapeHtml(page.title)}</span>
    `;
    item.addEventListener('click', () => handlePickPage(apiKey, page.id));
    list.appendChild(item);
  }

  picker.classList.add('visible');
}

async function handlePickPage(apiKey: string, parentPageId: string) {
  const picker = $('pagePicker');
  showNotionMessage('<span class="spinner"></span> creating databases...', 'info');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CREATE_NOTION_DATABASES',
      payload: { apiKey, parentPageId },
    });

    picker.classList.remove('visible');

    if (!response.success) {
      showNotionMessage(formatError(response.error), 'error');
      return;
    }

    showNotionMessage('databases created!', 'success');
    showConnected(apiKey);
  } catch (err) {
    showNotionMessage(formatError(String(err)), 'error');
  }
}

async function showConnected(apiKey: string) {
  $('connectedState').hidden = false;
  $('disconnectedState').hidden = true;
  $('pagePicker').classList.remove('visible');

  // Load config to show details
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const config: Partial<NotionConfig> = data[STORAGE_KEY]?.notionConfig ?? {};

  // Show integration name
  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (res.ok) {
      const user = await res.json();
      const name = user.name ?? user.bot?.owner?.user?.name ?? 'integration';
      $('integrationName').textContent = name.toLowerCase();
    }
  } catch { /* keep default */ }

  // Show database links
  const links = $('dbLinks');
  const sessId = config.sessionsDbId?.replace(/-/g, '');
  const annId = config.annotationsDbId?.replace(/-/g, '');
  links.innerHTML = [
    sessId ? `<a href="https://notion.so/${sessId}" target="_blank">chat sessions</a>` : '',
    annId ? `<a href="https://notion.so/${annId}" target="_blank">annotations</a>` : '',
  ].filter(Boolean).join(' · ');
}

async function handleDisconnect() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const storage = data[STORAGE_KEY] ?? {};

  if (storage.notionConfig) {
    // Keep apiKey for easy reconnect, clear database IDs
    storage.notionConfig = {
      apiKey: storage.notionConfig.apiKey,
      sessionsDbId: '',
      annotationsDbId: '',
      sessionsDsId: '',
      annotationsDsId: '',
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: storage });
  }

  $('connectedState').hidden = true;
  $('disconnectedState').hidden = false;

  // Pre-fill API key for reconnect
  const apiKey = storage.notionConfig?.apiKey ?? '';
  $input('apiKey').value = apiKey;

  showNotionMessage('disconnected. databases still exist in notion.', 'info');
}

// --- Defaults ---

async function saveDefaults() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const storage = data[STORAGE_KEY] ?? { sessions: {}, recentTags: [] };
  storage.defaultProject = $select('defaultProject').value;
  storage.defaultAutoPin = $input('defaultAutoPin').checked;
  await chrome.storage.local.set({ [STORAGE_KEY]: storage });
  showDefaultsMessage('saved!', 'success');
}

// --- Manual ID entry ---

async function saveManualIds() {
  const apiKey = $input('apiKey').value.trim();
  const config: NotionConfig = {
    apiKey,
    sessionsDbId: $input('sessionsDbId').value.trim(),
    annotationsDbId: $input('annotationsDbId').value.trim(),
    sessionsDsId: $input('sessionsDsId').value.trim(),
    annotationsDsId: $input('annotationsDsId').value.trim(),
  };

  const data = await chrome.storage.local.get(STORAGE_KEY);
  const storage = data[STORAGE_KEY] ?? { sessions: {}, recentTags: [] };
  storage.notionConfig = config;
  await chrome.storage.local.set({ [STORAGE_KEY]: storage });

  if (config.apiKey && config.sessionsDbId) {
    showConnected(config.apiKey);
  }
  showNotionMessage('manual ids saved!', 'success');
}

// --- Advanced toggle ---

function toggleAdvanced() {
  const fields = $('advancedFields');
  const toggle = $('advancedToggle');
  const visible = fields.classList.toggle('visible');
  toggle.innerHTML = visible
    ? '&#9660; advanced (manual ids)'
    : '&#9654; advanced (manual ids)';
}

// --- Helpers ---

function showNotionMessage(html: string, type: 'success' | 'error' | 'info') {
  const el = $('notionMessage');
  el.innerHTML = html;
  el.className = `message ${type}`;
}

function showDefaultsMessage(text: string, type: 'success' | 'error') {
  const el = $('defaultsMessage');
  el.textContent = text;
  el.className = `message ${type}`;
  setTimeout(() => { el.className = 'message'; }, 2000);
}

function formatError(err?: string): string {
  if (!err) return 'unknown error';
  if (err.includes('401')) return 'invalid api key. check it and try again.';
  if (err.includes('403')) return 'no access. share a page with your integration first.';
  if (err.includes('No accessible pages')) {
    return 'no pages found. share a page with your integration in notion first.';
  }
  return err.toLowerCase();
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
