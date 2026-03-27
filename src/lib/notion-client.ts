/**
 * Notion API client for the service worker.
 * Handles session creation, annotation saves, and brother page rebuilds.
 * Includes request queue with rate limiting (350ms min between calls).
 */

import type { Annotation, ChatSession, NotionConfig, NotionSetupResult } from './types';
import { exportForNotion } from './export';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const MIN_REQUEST_INTERVAL = 350; // ms between API calls

let lastRequestTime = 0;
let rebuildTimeout: ReturnType<typeof setTimeout> | null = null;

async function notionFetch(config: NotionConfig, path: string, method: string, body?: unknown): Promise<unknown> {
  // Rate limit: wait if we're calling too fast
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    // Rate limited — back off and retry once
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10);
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return notionFetch(config, path, method, body);
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Notion API ${method} ${path} failed (${res.status}): ${errorText}`);
  }

  return res.json();
}

// --- Auto-setup: search, validate, create databases ---

interface NotionSearchResult {
  results: Array<{
    id: string;
    object: string;
    title?: Array<{ plain_text: string }>;
    properties?: Record<string, { type: string }>;
    parent?: { type: string; page_id?: string };
    icon?: { type: string; emoji?: string };
  }>;
}

interface NotionDbResult {
  id: string;
  properties: Record<string, { type: string; id: string }>;
}

/**
 * Validate an API key by calling /users/me.
 */
export async function validateApiKey(apiKey: string): Promise<string> {
  const config: NotionConfig = {
    apiKey,
    sessionsDbId: '',
    annotationsDbId: '',
    sessionsDsId: '',
    annotationsDsId: '',
  };
  const result = await notionFetch(config, '/users/me', 'GET') as {
    name?: string;
    bot?: { owner?: { user?: { name?: string } } };
  };
  return result.name ?? result.bot?.owner?.user?.name ?? 'Integration';
}

/**
 * Search for existing Chat Sessions and Annotations databases.
 * Returns their IDs if both are found with correct schemas.
 */
export async function searchForDatabases(
  apiKey: string,
): Promise<NotionSetupResult | null> {
  const config: NotionConfig = {
    apiKey,
    sessionsDbId: '',
    annotationsDbId: '',
    sessionsDsId: '',
    annotationsDsId: '',
  };

  const sessionsSearch = await notionFetch(config, '/search', 'POST', {
    query: 'Chat Sessions',
    filter: { value: 'database', property: 'object' },
    page_size: 10,
  }) as NotionSearchResult;

  const annotationsSearch = await notionFetch(config, '/search', 'POST', {
    query: 'Annotations',
    filter: { value: 'database', property: 'object' },
    page_size: 10,
  }) as NotionSearchResult;

  // Find databases with matching schemas
  const sessionsDb = sessionsSearch.results.find(db =>
    hasTitle(db, 'Chat Sessions') && hasRequiredProps(db, ['Chat ID', 'Chat URL', 'Project']),
  );
  const annotationsDb = annotationsSearch.results.find(db =>
    hasTitle(db, 'Annotations') && hasRequiredProps(db, ['Highlight', 'Type', 'Note']),
  );

  if (!sessionsDb || !annotationsDb) return null;

  const parentTitle = await getPageTitle(config, sessionsDb);

  return {
    sessionsDbId: sessionsDb.id,
    annotationsDbId: annotationsDb.id,
    sessionsDsId: '',
    annotationsDsId: '',
    parentPageTitle: parentTitle,
  };
}

function hasTitle(db: NotionSearchResult['results'][0], title: string): boolean {
  return db.title?.some(t => t.plain_text === title) ?? false;
}

function hasRequiredProps(
  db: NotionSearchResult['results'][0],
  props: string[],
): boolean {
  if (!db.properties) return false;
  return props.every(p => p in db.properties!);
}

async function getPageTitle(
  config: NotionConfig,
  db: NotionSearchResult['results'][0],
): Promise<string> {
  if (db.parent?.type !== 'page_id' || !db.parent.page_id) return 'Unknown';
  try {
    const page = await notionFetch(config, `/pages/${db.parent.page_id}`, 'GET') as {
      properties?: Record<string, { title?: Array<{ plain_text: string }> }>;
    };
    const titleProp = Object.values(page.properties ?? {}).find(p => p.title);
    return titleProp?.title?.[0]?.plain_text ?? 'Untitled';
  } catch {
    return 'Unknown';
  }
}

/**
 * Get pages the integration can access (for parent selection).
 */
export async function getAccessiblePages(
  apiKey: string,
): Promise<Array<{ id: string; title: string; icon?: string }>> {
  const config: NotionConfig = {
    apiKey,
    sessionsDbId: '',
    annotationsDbId: '',
    sessionsDsId: '',
    annotationsDsId: '',
  };

  const result = await notionFetch(config, '/search', 'POST', {
    filter: { value: 'page', property: 'object' },
    page_size: 20,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  }) as { results: Array<{
    id: string;
    parent?: { type: string };
    properties?: Record<string, { type: string; title?: Array<{ plain_text: string }> }>;
    icon?: { type: string; emoji?: string };
  }> };

  // Only show top-level pages (workspace or page parent, not database children)
  return result.results
    .filter(p => p.parent?.type !== 'database_id')
    .map(page => {
      const titleProp = Object.values(page.properties ?? {}).find(p => p.type === 'title');
      const title = titleProp?.title?.[0]?.plain_text ?? 'Untitled';
      const icon = page.icon?.type === 'emoji' ? page.icon.emoji : undefined;
      return { id: page.id, title, icon };
    });
}

/**
 * Create both databases under a parent page.
 */
export async function createDatabases(
  apiKey: string,
  parentPageId: string,
): Promise<NotionSetupResult> {
  const config: NotionConfig = {
    apiKey,
    sessionsDbId: '',
    annotationsDbId: '',
    sessionsDsId: '',
    annotationsDsId: '',
  };

  // Create Chat Sessions database
  const sessionsDb = await notionFetch(config, '/databases', 'POST', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Chat Sessions' } }],
    properties: {
      'Session Title': { title: {} },
      'Chat ID': { rich_text: {} },
      'Chat URL': { url: {} },
      'Project': {
        select: {
          options: [
            { name: 'kyma', color: 'blue' },
            { name: 'personal', color: 'green' },
            { name: 'learning', color: 'purple' },
            { name: 'other', color: 'gray' },
          ],
        },
      },
      'Status': {
        select: {
          options: [
            { name: 'Active', color: 'green' },
            { name: 'Archived', color: 'gray' },
            { name: 'Reviewed', color: 'blue' },
          ],
        },
      },
    },
  }) as NotionDbResult;

  // Create Annotations database with relation to Sessions
  const annotationsDb = await notionFetch(config, '/databases', 'POST', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Annotations' } }],
    properties: {
      'Highlight': { title: {} },
      'Session': { relation: { database_id: sessionsDb.id, type: 'single_property' } },
      'Type': {
        select: {
          options: [
            { name: 'insight', color: 'purple' },
            { name: 'question', color: 'blue' },
            { name: 'action-item', color: 'red' },
            { name: 'idea', color: 'pink' },
            { name: 'reference', color: 'gray' },
            { name: 'issue', color: 'orange' },
            { name: 'pattern', color: 'yellow' },
          ],
        },
      },
      'Note': { rich_text: {} },
      'Full Highlight': { rich_text: {} },
      'Tags': { multi_select: { options: [] } },
      'Source': {
        select: {
          options: [
            { name: 'claude-response', color: 'purple' },
            { name: 'user-message', color: 'blue' },
            { name: 'artifact', color: 'green' },
          ],
        },
      },
      'Message Index': { number: {} },
      'Status': {
        select: {
          options: [
            { name: 'Active', color: 'green' },
            { name: 'Resolved', color: 'gray' },
          ],
        },
      },
    },
  }) as NotionDbResult;

  // Get parent page title
  let parentPageTitle = 'Claudemot';
  try {
    const page = await notionFetch(config, `/pages/${parentPageId}`, 'GET') as {
      properties?: Record<string, { title?: Array<{ plain_text: string }> }>;
    };
    const titleProp = Object.values(page.properties ?? {}).find(p => p.title);
    parentPageTitle = titleProp?.title?.[0]?.plain_text ?? 'Untitled';
  } catch { /* use default */ }

  return {
    sessionsDbId: sessionsDb.id,
    annotationsDbId: annotationsDb.id,
    sessionsDsId: '',
    annotationsDsId: '',
    parentPageTitle,
  };
}

/**
 * Create a Chat Session page in Notion.
 */
export async function createNotionSession(config: NotionConfig, session: ChatSession): Promise<string> {
  const result = await notionFetch(config, '/pages', 'POST', {
    parent: { database_id: config.sessionsDbId },
    properties: {
      'Session Title': {
        title: [{ text: { content: session.title } }],
      },
      'Chat ID': {
        rich_text: [{ text: { content: session.chatId } }],
      },
      'Chat URL': {
        url: session.chatUrl,
      },
      'Project': {
        select: { name: session.project },
      },
      'Status': {
        select: { name: 'Active' },
      },
    },
  }) as { id: string };

  return result.id;
}

/**
 * Create an Annotation page in Notion.
 */
export async function createNotionAnnotation(
  config: NotionConfig,
  annotation: Annotation,
  sessionNotionId: string,
): Promise<string> {
  const highlight = annotation.highlightText.slice(0, 80);

  const result = await notionFetch(config, '/pages', 'POST', {
    parent: { database_id: config.annotationsDbId },
    properties: {
      'Highlight': {
        title: [{ text: { content: highlight } }],
      },
      'Session': {
        relation: [{ id: sessionNotionId }],
      },
      'Type': {
        select: { name: annotation.type },
      },
      'Tags': {
        multi_select: annotation.tags.map(t => ({ name: t })),
      },
      'Note': {
        rich_text: [{ text: { content: annotation.note.slice(0, 2000) } }],
      },
      'Source': {
        select: { name: annotation.source },
      },
      'Message Index': {
        number: annotation.messageIndex,
      },
      'Full Highlight': {
        rich_text: [{ text: { content: annotation.highlightText.slice(0, 2000) } }],
      },
    },
  }) as { id: string };

  return result.id;
}

/**
 * Update an annotation's Status property to "Resolved" in Notion.
 */
export async function resolveNotionAnnotation(
  config: NotionConfig,
  notionPageId: string,
): Promise<void> {
  await notionFetch(config, `/pages/${notionPageId}`, 'PATCH', {
    properties: {
      'Status': {
        select: { name: 'Resolved' },
      },
    },
  });
}

/**
 * Rebuild the brother page content for a session.
 * Debounced: waits 2 seconds after the last call before executing.
 */
export function scheduleBrotherPageRebuild(config: NotionConfig, session: ChatSession): void {
  if (rebuildTimeout) {
    clearTimeout(rebuildTimeout);
  }
  rebuildTimeout = setTimeout(() => {
    rebuildBrotherPage(config, session).catch(err => {
      console.error('[Claudemot] Failed to rebuild brother page:', err);
    });
  }, 2000);
}

async function rebuildBrotherPage(config: NotionConfig, session: ChatSession): Promise<void> {
  if (!session.notionPageId) return;

  const content = exportForNotion(session);

  // Get existing children to clear them
  const children = await notionFetch(
    config,
    `/blocks/${session.notionPageId}/children?page_size=100`,
    'GET',
  ) as { results: { id: string }[] };

  // Delete existing blocks
  for (const block of children.results) {
    await notionFetch(config, `/blocks/${block.id}`, 'DELETE');
  }

  // Convert markdown to Notion blocks (simplified — paragraph blocks with rich text)
  const blocks = markdownToNotionBlocks(content);
  await notionFetch(config, `/blocks/${session.notionPageId}/children`, 'PATCH', {
    children: blocks,
  });
}

/**
 * Simple markdown-to-Notion-blocks converter.
 * Handles headings, blockquotes, list items, checkboxes, horizontal rules, and paragraphs.
 */
function markdownToNotionBlocks(md: string): unknown[] {
  const lines = md.split('\n');
  const blocks: unknown[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }] },
      });
    } else if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }] },
      });
    } else if (trimmed.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: parseRichText(trimmed.slice(2)) },
      });
    } else if (trimmed.startsWith('- [ ] ')) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: parseRichText(trimmed.slice(6)), checked: false },
      });
    } else if (trimmed.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseRichText(trimmed.slice(2)) },
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: parseRichText(trimmed) },
      });
    }
  }

  return blocks;
}

/**
 * Parse simple markdown rich text (bold with **).
 */
function parseRichText(text: string): unknown[] {
  const parts: unknown[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: { content: text.slice(lastIndex, match.index) } });
    }
    parts.push({
      type: 'text',
      text: { content: match[1] },
      annotations: { bold: true },
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: { content: text.slice(lastIndex) } });
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: { content: text } }];
}
