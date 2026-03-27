/**
 * Main content script — injected into claude.ai/chat/* pages.
 */

import type { Annotation, ExtensionMessage, ExtensionResponse, MessageSource, SaveAnnotationPayload } from '../lib/types';
import { SessionTracker } from './session-tracker';
import { AnnotationPopup } from './annotation-popup';
import { Sidebar } from './sidebar';
import { HighlightRenderer } from './highlight-renderer';

const tracker = new SessionTracker();
const popup = new AnnotationPopup();
const highlights = new HighlightRenderer();
let sidebar: Sidebar | null = null;
let recentTags: string[] = ['architecture', 'product', 'technique', 'important'];
let fab: HTMLButtonElement | null = null;
let loadingChatId: string | null = null;

// Inject Google Fonts into page head (content CSS @import blocked by CSP)
function injectFonts(): void {
  if (document.getElementById('claudemot-fonts')) return;
  const link = document.createElement('link');
  link.id = 'claudemot-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Orbitron:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
}

function init(): void {
  try {
    injectFonts();

    sidebar = new Sidebar({
    onExport: handleExport,
    onResolve: handleResolve,
    onPin: handlePin,
    onExportSelected: handleExportSelected,
  });

  // Wire up resolve from highlight click
  highlights.setResolveHandler(handleResolve);

  const chatId = tracker.getChatId();
  if (chatId) {
    loadAnnotations(chatId);
    loadRecentTags();
  }

  createFab();

  tracker.onSessionChange((newChatId) => {
    highlights.clearAll();
    sidebar?.updateAnnotations([]);
    updateFab(0);
    if (newChatId) {
      loadAnnotations(newChatId);
    }
  });

  document.addEventListener('mouseup', handleMouseUp);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
    }
    if (mod && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      triggerAnnotation();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'COMMAND_ANNOTATE') {
      triggerAnnotation();
      sendResponse({ success: true });
    } else if (msg.type === 'COMMAND_TOGGLE_SIDEBAR') {
      toggleSidebar();
      sendResponse({ success: true });
    }
    return true;
  });

  } catch {
    // init failed silently — extension won't activate on this page
  }
}

// --- Input area detection ---
function isInsideInputArea(node: Node | null): boolean {
  if (!node) return false;
  const el = node instanceof HTMLElement ? node : node.parentElement;
  if (!el) return false;
  return !!el.closest(
    'textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"], ' +
    '[role="textbox"], .ProseMirror, .tiptap, [class*="composer"], [class*="editor"]'
  );
}

function handleMouseUp(e: MouseEvent): void {
  // Require Option/Alt key held during selection to trigger annotation
  if (!e.altKey) return;

  const target = e.target as HTMLElement;
  if (target.closest('#claudemot-popup, #claudemot-sidebar, .ca-comment-rail')) return;
  if (isInsideInputArea(target)) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
  if (isInsideInputArea(selection.anchorNode) || isInsideInputArea(selection.focusNode)) return;

  const chatId = tracker.getChatId();
  if (!chatId) return;

  const selectedText = selection.toString().trim();
  if (selectedText.length < 3) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const { source, messageIndex } = detectMessageContext(range.startContainer);

  popup.show({
    rect,
    selectedText,
    source,
    messageIndex,
    chatId,
    chatUrl: tracker.getChatUrl(),
    recentTags,
    onSave: handleSave,
    onDismiss: () => selection.removeAllRanges(),
  });
}

function toggleSidebar(): void {
  sidebar?.toggle();
  const chatId = tracker.getChatId();
  if (chatId) loadAnnotations(chatId);
}

function createFab(): void {
  if (fab) return;
  fab = document.createElement('button');
  fab.id = 'claudemot-fab';
  fab.className = 'ca-fab';
  fab.textContent = 'view all';
  fab.style.display = 'none';
  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar();
  });
  document.body.appendChild(fab);
}

function updateFab(count: number): void {
  if (!fab) createFab();
  if (!fab) return;
  fab.style.display = count > 0 ? 'flex' : 'none';
}

function triggerAnnotation(): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  handleMouseUp(new MouseEvent('mouseup'));
}

function detectMessageContext(node: Node): { source: MessageSource; messageIndex: number } {
  let element: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
  let messageIndex = 0;
  let source: MessageSource = 'claude-response';

  while (element && element !== document.body) {
    const testId = element.getAttribute('data-testid');
    if (testId) {
      if (testId.includes('human') || testId.includes('user')) source = 'user-message';
      if (testId.includes('assistant') || testId.includes('claude')) source = 'claude-response';
    }
    const cls = element.className;
    if (typeof cls === 'string') {
      if (cls.includes('human') || cls.includes('user-message') || cls.includes('UserMessage')) source = 'user-message';
      if (cls.includes('assistant') || cls.includes('Agent') || cls.includes('bot')) source = 'claude-response';
    }
    const role = element.getAttribute('data-role');
    if (role === 'user') source = 'user-message';
    if (role === 'assistant') source = 'claude-response';
    element = element.parentElement;
  }

  const allMessages = document.querySelectorAll('[data-testid*="message"], [class*="Message"], [class*="message-row"]');
  const startNode = node instanceof HTMLElement ? node : node.parentElement;
  allMessages.forEach((msg, idx) => {
    if (startNode && msg.contains(startNode)) messageIndex = idx;
  });

  return { source, messageIndex };
}

async function handleSave(payload: SaveAnnotationPayload): Promise<void> {
  try {
    const response = await sendMessage({ type: 'SAVE_ANNOTATION', payload });
    if (response.success && response.data) {
      const annotation = response.data as Annotation;
      highlights.addHighlight(annotation);
      updateFab(highlights.getAnnotationCount());
      const allResp = await sendMessage({
        type: 'GET_ANNOTATIONS',
        payload: { chatId: payload.chatId },
      });
      if (allResp.success && allResp.data) {
        sidebar?.updateAnnotations(allResp.data as Annotation[]);
      }
      showToast('saved!');
    } else {
      const errMsg = response.error ?? 'unknown error';
      if (errMsg.includes('invalidated') || errMsg.includes('disconnected')) {
        showToast('extension reloaded — refresh this page', true);
      } else {
        showToast('failed: ' + errMsg.slice(0, 40), true);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('invalidated') || msg.includes('disconnected')) {
      showToast('extension reloaded — refresh this page', true);
    } else {
      showToast('failed: ' + msg.slice(0, 40), true);
    }
  }
}

async function handleResolve(annotationId: string): Promise<void> {
  const chatId = tracker.getChatId();
  if (!chatId) return;
  const response = await sendMessage({
    type: 'RESOLVE_ANNOTATION',
    payload: { id: annotationId, chatId },
  });
  if (response.success) {
    // Resolve = remove locally, so remove highlight from DOM
    highlights.removeHighlight(annotationId);
    loadAnnotations(chatId);
    showToast('Resolved');
  }
}

async function handlePin(annotationIds: string[]): Promise<void> {
  const chatId = tracker.getChatId();
  if (!chatId) return;
  const response = await sendMessage({
    type: 'PIN_ANNOTATIONS',
    payload: { chatId, annotationIds },
  });
  if (response.success) {
    loadAnnotations(chatId);
    showToast('Saved to Notion');
  } else {
    showToast('Pin failed', true);
  }
}

async function handleExportSelected(annotationIds: string[]): Promise<void> {
  const chatId = tracker.getChatId();
  if (!chatId) return;
  const response = await sendMessage({
    type: 'EXPORT_SELECTED',
    payload: { chatId, annotationIds },
  });
  if (response.success && response.data) {
    await navigator.clipboard.writeText(response.data as string);
    showToast('Copied to clipboard!');
  } else {
    showToast('Export failed', true);
  }
}

async function handleExport(): Promise<void> {
  const chatId = tracker.getChatId();
  if (!chatId) return;
  const response = await sendMessage({ type: 'EXPORT_SESSION', payload: { chatId } });
  if (response.success && response.data) {
    await navigator.clipboard.writeText(response.data as string);
    showToast('Copied to clipboard!');
  } else {
    showToast('Export failed', true);
  }
}

async function loadAnnotations(chatId: string): Promise<void> {
  // Prevent concurrent loads — only the latest navigation wins
  loadingChatId = chatId;
  const response = await sendMessage({ type: 'GET_ANNOTATIONS', payload: { chatId } });
  // Discard if user navigated away while we were fetching
  if (loadingChatId !== chatId || tracker.getChatId() !== chatId) return;
  loadingChatId = null;
  if (response.success && response.data) {
    const annotations = response.data as Annotation[];
    sidebar?.updateAnnotations(annotations);
    highlights.clearAll();
    for (const a of annotations) highlights.addHighlight(a);
    updateFab(annotations.length);
  }
}

async function loadRecentTags(): Promise<void> {
  const data = await chrome.storage.local.get('claudeAnnotator');
  if (data.claudeAnnotator?.recentTags) recentTags = data.claudeAnnotator.recentTags;
}

function sendMessage(msg: ExtensionMessage): Promise<ExtensionResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response: ExtensionResponse) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response ?? { success: false, error: 'no response from service worker' });
        }
      });
    } catch (err) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

function showToast(message: string, isError = false): void {
  document.getElementById('claudemot-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'claudemot-toast';
  toast.className = `ca-toast ${isError ? 'ca-toast-error' : 'ca-toast-success'}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('ca-toast-visible'));
  setTimeout(() => {
    toast.classList.remove('ca-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

init();
