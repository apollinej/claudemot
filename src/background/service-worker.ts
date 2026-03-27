/**
 * MV3 Service Worker — handles all Notion API communication and storage orchestration.
 * The content script never talks to Notion directly; everything routes through here.
 */

import type {
  Annotation,
  ChatSession,
  ExtensionMessage,
  ExtensionResponse,
  NotionConfig,
  PinAnnotationsPayload,
  ExportSelectedPayload,
  SaveAnnotationPayload,
} from '../lib/types';
import {
  getSession,
  upsertSession,
  saveAnnotation as storeSaveAnnotation,
  getAnnotations,
  deleteAnnotation as storeDeleteAnnotation,
  updateAnnotation,
  getNotionConfig,
  addRecentTags,
  getDefaultProject,
} from '../lib/storage';
import { exportForClaude, exportSelectedForClaude } from '../lib/export';
import {
  createNotionSession,
  createNotionAnnotation,
  resolveNotionAnnotation,
  scheduleBrotherPageRebuild,
  validateApiKey,
  searchForDatabases,
  getAccessiblePages,
  createDatabases,
} from '../lib/notion-client';
import { setNotionConfig } from '../lib/storage';

// --- Message handler ---
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionResponse) => void) => {
    handleMessage(message)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: String(err) }));

    return true; // keep the message channel open for async response
  }
);

// --- Keyboard shortcut commands ---
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.includes('claude.ai/chat/')) return;

    if (command === 'annotate') {
      chrome.tabs.sendMessage(tab.id, { type: 'COMMAND_ANNOTATE' });
    } else if (command === 'toggle-sidebar') {
      chrome.tabs.sendMessage(tab.id, { type: 'COMMAND_TOGGLE_SIDEBAR' });
    }
  });
});

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'SAVE_ANNOTATION':
      return handleSaveAnnotation(message.payload as SaveAnnotationPayload);

    case 'GET_ANNOTATIONS': {
      const p = message.payload as { chatId: string };
      const annotations = await getAnnotations(p.chatId);
      return { success: true, data: annotations };
    }

    case 'DELETE_ANNOTATION': {
      const dp = message.payload as { id: string; chatId: string };
      await storeDeleteAnnotation(dp.chatId, dp.id);
      return { success: true };
    }

    case 'RESOLVE_ANNOTATION': {
      const rp = message.payload as { id: string; chatId: string };
      return handleResolveAnnotation(rp.chatId, rp.id);
    }

    case 'EXPORT_SESSION': {
      const ep = message.payload as { chatId: string };
      const session = await getSession(ep.chatId);
      if (!session) return { success: false, error: 'Session not found' };
      const markdown = exportForClaude(session);
      return { success: true, data: markdown };
    }

    case 'GET_SESSION': {
      const sp = message.payload as { chatId: string };
      const session = await getSession(sp.chatId);
      return { success: true, data: session };
    }

    case 'PIN_ANNOTATIONS':
      return handlePinAnnotations(message.payload as PinAnnotationsPayload);

    case 'EXPORT_SELECTED':
      return handleExportSelected(message.payload as ExportSelectedPayload);

    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      return { success: true };

    case 'CLEAR_ALL_DATA': {
      await chrome.storage.local.remove('claudeAnnotator');
      return { success: true };
    }

    case 'SETUP_NOTION':
      return handleSetupNotion(message.payload as unknown as { apiKey: string });

    case 'SEARCH_NOTION_DATABASES':
      return handleSearchDatabases(message.payload as unknown as { apiKey: string });

    case 'GET_ACCESSIBLE_PAGES':
      return handleGetAccessiblePages(message.payload as unknown as { apiKey: string });

    case 'CREATE_NOTION_DATABASES':
      return handleCreateDatabases(
        message.payload as unknown as { apiKey: string; parentPageId: string },
      );

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

async function handleSaveAnnotation(payload: SaveAnnotationPayload): Promise<ExtensionResponse> {
  // Compute sequenceNumber: max existing + 1
  const existing = await getAnnotations(payload.chatId);
  const maxSeq = existing.reduce((max, a) => Math.max(max, a.sequenceNumber ?? 0), 0);

  const annotation: Annotation = {
    id: crypto.randomUUID(),
    chatId: payload.chatId,
    highlightText: payload.highlightText,
    note: payload.note,
    type: payload.type,
    tags: payload.tags,
    source: payload.source,
    messageIndex: payload.messageIndex,
    timestamp: Date.now(),
    sequenceNumber: maxSeq + 1,
    pinned: payload.pinned ?? false,
    synced: false,
  };

  // Ensure session exists locally
  let session = await getSession(payload.chatId);
  if (!session) {
    const defaultProject = await getDefaultProject();
    session = {
      chatId: payload.chatId,
      chatUrl: payload.chatUrl,
      title: generateSessionTitle(annotation),
      project: defaultProject,
      createdAt: Date.now(),
      annotations: [],
    };
    await upsertSession(session);
  }

  // Save annotation locally
  await storeSaveAnnotation(annotation);

  // Update recent tags
  if (annotation.tags.length > 0) {
    await addRecentTags(annotation.tags);
  }

  // Only sync to Notion if pinned
  if (annotation.pinned) {
    syncToNotion(annotation, session).catch(err => {
      console.warn('[Claudemot] Notion sync failed (will retry):', err);
    });
  }

  return { success: true, data: annotation };
}

async function syncToNotion(annotation: Annotation, session: ChatSession): Promise<void> {
  const config = await getNotionConfig();
  if (!config?.apiKey) return; // Notion not configured, local-only mode

  try {
    // Ensure session exists in Notion
    if (!session.notionPageId) {
      const notionPageId = await createNotionSession(config, session);
      session.notionPageId = notionPageId;
      await upsertSession(session);
    }

    // Create annotation in Notion
    const notionAnnotationId = await createNotionAnnotation(config, annotation, session.notionPageId);
    annotation.notionPageId = notionAnnotationId;
    annotation.synced = true;

    // Update annotation in storage with Notion ID
    await updateAnnotation(session.chatId, annotation);

    // Refresh session with all annotations for brother page rebuild
    const allAnnotations = await getAnnotations(session.chatId);
    const updatedSession = { ...session, annotations: allAnnotations };

    // Schedule brother page rebuild (debounced)
    scheduleBrotherPageRebuild(config, updatedSession);
  } catch (err) {
    console.error('[Claudemot] Notion sync error:', err);
  }
}

async function handleResolveAnnotation(
  chatId: string,
  annotationId: string,
): Promise<ExtensionResponse> {
  const annotations = await getAnnotations(chatId);
  const annotation = annotations.find(a => a.id === annotationId);
  if (!annotation) return { success: false, error: 'Annotation not found' };

  // If pinned and synced to Notion, mark resolved there first
  if (annotation.notionPageId) {
    resolveInNotion(annotation).catch(err => {
      console.warn('[Claudemot] Notion resolve sync failed:', err);
    });
  }

  // Delete from local storage (resolve = remove locally)
  await storeDeleteAnnotation(chatId, annotationId);

  return { success: true };
}

async function handlePinAnnotations(payload: PinAnnotationsPayload): Promise<ExtensionResponse> {
  const { chatId, annotationIds } = payload;
  const annotations = await getAnnotations(chatId);
  const session = await getSession(chatId);
  if (!session) return { success: false, error: 'Session not found' };

  let pinCount = 0;
  for (const id of annotationIds) {
    const annotation = annotations.find(a => a.id === id);
    if (!annotation) continue;

    annotation.pinned = true;
    await updateAnnotation(chatId, annotation);

    // Sync to Notion
    syncToNotion(annotation, session).catch(err => {
      console.warn('[Claudemot] Notion pin sync failed:', err);
    });
    pinCount++;
  }

  return { success: true, data: { count: pinCount } };
}

async function handleExportSelected(payload: ExportSelectedPayload): Promise<ExtensionResponse> {
  const { chatId, annotationIds } = payload;
  const session = await getSession(chatId);
  if (!session) return { success: false, error: 'Session not found' };

  // Reload annotations into session
  const annotations = await getAnnotations(chatId);
  const fullSession = { ...session, annotations };

  const markdown = exportSelectedForClaude(fullSession, annotationIds);
  return { success: true, data: markdown };
}

async function resolveInNotion(annotation: Annotation): Promise<void> {
  if (!annotation.notionPageId) return;
  const config = await getNotionConfig();
  if (!config?.apiKey) return;
  await resolveNotionAnnotation(config, annotation.notionPageId);
}

function generateSessionTitle(firstAnnotation: Annotation): string {
  const typeLabel = firstAnnotation.type.charAt(0).toUpperCase() + firstAnnotation.type.slice(1);
  const excerpt = firstAnnotation.highlightText.slice(0, 50);
  return `${typeLabel}: ${excerpt}${firstAnnotation.highlightText.length > 50 ? '...' : ''}`;
}

// --- Notion auto-setup handlers ---

async function handleSetupNotion(
  payload: { apiKey: string },
): Promise<ExtensionResponse> {
  try {
    const name = await validateApiKey(payload.apiKey);

    // Try to find existing databases
    const existing = await searchForDatabases(payload.apiKey);
    if (existing) {
      await setNotionConfig({
        apiKey: payload.apiKey,
        sessionsDbId: existing.sessionsDbId,
        annotationsDbId: existing.annotationsDbId,
        sessionsDsId: existing.sessionsDsId,
        annotationsDsId: existing.annotationsDsId,
      });
      return {
        success: true,
        data: {
          status: 'connected',
          integrationName: name,
          ...existing,
        },
      };
    }

    // No existing databases — need user to pick a parent page
    const pages = await getAccessiblePages(payload.apiKey);
    if (pages.length === 0) {
      return {
        success: false,
        error: 'No accessible pages found. Share a page with your integration first.',
      };
    }

    return {
      success: true,
      data: {
        status: 'needs_parent',
        integrationName: name,
        pages,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function handleSearchDatabases(
  payload: { apiKey: string },
): Promise<ExtensionResponse> {
  try {
    const result = await searchForDatabases(payload.apiKey);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function handleGetAccessiblePages(
  payload: { apiKey: string },
): Promise<ExtensionResponse> {
  try {
    const pages = await getAccessiblePages(payload.apiKey);
    return { success: true, data: pages };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function handleCreateDatabases(
  payload: { apiKey: string; parentPageId: string },
): Promise<ExtensionResponse> {
  try {
    const result = await createDatabases(payload.apiKey, payload.parentPageId);

    await setNotionConfig({
      apiKey: payload.apiKey,
      sessionsDbId: result.sessionsDbId,
      annotationsDbId: result.annotationsDbId,
      sessionsDsId: result.sessionsDsId,
      annotationsDsId: result.annotationsDsId,
    });

    return {
      success: true,
      data: {
        status: 'connected',
        ...result,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
