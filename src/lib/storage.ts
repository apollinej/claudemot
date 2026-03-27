import type { Annotation, ChatSession, NotionConfig, StorageData } from './types';

const STORAGE_KEY = 'claudeAnnotator';

function getDefaultStorage(): StorageData {
  return {
    sessions: {},
    defaultProject: 'personal',
    recentTags: ['architecture', 'product', 'technique', 'important'],
  };
}

export async function getStorage(): Promise<StorageData> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? getDefaultStorage();
}

async function setStorage(data: StorageData): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

// --- Session operations ---

export async function getSession(chatId: string): Promise<ChatSession | null> {
  const data = await getStorage();
  return data.sessions[chatId] ?? null;
}

export async function upsertSession(session: ChatSession): Promise<void> {
  const data = await getStorage();
  data.sessions[session.chatId] = session;
  await setStorage(data);
}

// --- Annotation operations ---

export async function saveAnnotation(annotation: Annotation): Promise<void> {
  const data = await getStorage();
  const session = data.sessions[annotation.chatId];
  if (!session) {
    return;
  }

  session.annotations.push(annotation);
  await setStorage(data);
}

export async function getAnnotations(chatId: string): Promise<Annotation[]> {
  const session = await getSession(chatId);
  return session?.annotations ?? [];
}

export async function deleteAnnotation(chatId: string, annotationId: string): Promise<void> {
  const data = await getStorage();
  const session = data.sessions[chatId];
  if (!session) return;

  session.annotations = session.annotations.filter(a => a.id !== annotationId);
  await setStorage(data);
}

export async function updateAnnotation(chatId: string, updated: Annotation): Promise<void> {
  const data = await getStorage();
  const session = data.sessions[chatId];
  if (!session) return;

  const idx = session.annotations.findIndex(a => a.id === updated.id);
  if (idx !== -1) {
    session.annotations[idx] = updated;
    await setStorage(data);
  }
}

// --- Config operations ---

export async function getNotionConfig(): Promise<NotionConfig | null> {
  const data = await getStorage();
  return data.notionConfig ?? null;
}

export async function setNotionConfig(config: NotionConfig): Promise<void> {
  const data = await getStorage();
  data.notionConfig = config;
  await setStorage(data);
}

// --- Tags ---

export async function getRecentTags(): Promise<string[]> {
  const data = await getStorage();
  return data.recentTags;
}

export async function addRecentTags(tags: string[]): Promise<void> {
  const data = await getStorage();
  const existing = new Set(data.recentTags);
  for (const tag of tags) {
    existing.add(tag.toLowerCase().trim());
  }
  data.recentTags = Array.from(existing).slice(0, 50); // cap at 50 recent tags
  await setStorage(data);
}

// --- Default project ---

export async function getDefaultProject(): Promise<string> {
  const data = await getStorage();
  return data.defaultProject;
}

export async function setDefaultProject(project: string): Promise<void> {
  const data = await getStorage();
  data.defaultProject = project;
  await setStorage(data);
}
