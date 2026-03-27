/**
 * Generates structured markdown exports from session annotations.
 * Two formats: one for pasting into Claude, one for the Notion brother page.
 */

import { ANNOTATION_TYPES } from './constants';
import type { Annotation, AnnotationType, ChatSession } from './types';

type GroupedAnnotations = Map<AnnotationType, Annotation[]>;

const TYPE_ORDER: AnnotationType[] = [
  'insight', 'question', 'action-item', 'idea',
  'issue', 'reference', 'pattern',
];

const CLAUDE_SECTION_TITLES: Record<AnnotationType, string> = {
  'insight': 'What resonated (Insights)',
  'question': 'Questions I still have for you',
  'action-item': 'Action items I have for you to address',
  'idea': 'Ideas sparked',
  'issue': 'Issues / Disagreements',
  'reference': 'References to explore',
  'pattern': 'Patterns noticed',
};

const NOTION_SECTION_TITLES: Record<AnnotationType, string> = {
  'insight': 'Insights',
  'question': 'Questions',
  'action-item': 'Action Items',
  'idea': 'Ideas',
  'issue': 'Issues',
  'reference': 'References',
  'pattern': 'Patterns',
};

function groupAnnotations(annotations: Annotation[]): GroupedAnnotations {
  const map: GroupedAnnotations = new Map();
  for (const a of annotations.sort((a, b) => a.messageIndex - b.messageIndex)) {
    const list = map.get(a.type) ?? [];
    list.push(a);
    map.set(a.type, list);
  }
  return map;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function formatTags(tags: string[]): string {
  return tags.length > 0 ? ' ' + tags.map(t => `#${t}`).join(', ') : '';
}

/**
 * Structured markdown for pasting into a new Claude conversation.
 * Designed so Claude understands what the user found valuable.
 */
export function exportForClaude(session: ChatSession): string {
  // Exclude resolved annotations from clipboard export
  const active = session.annotations.filter(a => !a.resolved);
  const grouped = groupAnnotations(active);
  const dateRange = getDateRange(session.annotations);

  let md = `# Here are my thoughts from this session\n`;
  md += `> From: ${session.chatUrl}\n`;
  md += `> Date: ${dateRange}\n`;
  md += `> Project: ${session.project}\n\n`;

  for (const type of TYPE_ORDER) {
    const items = grouped.get(type);
    if (!items || items.length === 0) continue;

    md += `## ${CLAUDE_SECTION_TITLES[type]}\n`;

    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const excerpt = truncate(a.highlightText, 200);

      if (type === 'action-item') {
        md += `- [ ] ${a.note || excerpt}`;
        if (a.note) md += ` (from: "${truncate(a.highlightText, 80)}")`;
        md += `${formatTags(a.tags)}\n`;
      } else {
        md += `${i + 1}. **"${excerpt}"**\n`;
        if (a.note) md += `   > My note: ${a.note}\n`;
        if (a.tags.length) md += `   > Tags: ${formatTags(a.tags)}\n`;
        md += '\n';
      }
    }
    md += '\n';
  }

  md += `---\n*${active.length} annotations from ${dateRange}. Continue this thread or explore a specific section.*\n`;
  return md;
}

/**
 * Notion-flavored markdown for the "brother" page body.
 */
export function exportForNotion(session: ChatSession): string {
  const grouped = groupAnnotations(session.annotations);

  let md = `> **Chat**: [Open in Claude](${session.chatUrl})\n`;
  md += `> **Project**: ${session.project}\n`;
  md += `> **Annotations**: ${session.annotations.length}\n`;
  md += `> **Last synced**: ${new Date().toISOString().split('T')[0]}\n\n---\n\n`;

  for (const type of TYPE_ORDER) {
    const items = grouped.get(type);
    if (!items || items.length === 0) continue;

    const typeInfo = ANNOTATION_TYPES.find(t => t.value === type);
    md += `## ${NOTION_SECTION_TITLES[type]}\n`;

    for (const a of items) {
      const excerpt = truncate(a.highlightText, 150);
      const tagStr = a.tags.length ? ' ' + a.tags.map(t => '`#' + t + '`').join(' ') : '';

      if (type === 'action-item') {
        md += `- [ ] **"${excerpt}"** — ${a.note || '(no note)'}${tagStr}\n`;
      } else {
        md += `- **"${excerpt}"** — ${a.note || '(no note)'}${tagStr}\n`;
      }
    }
    md += '\n';
  }

  return md;
}

/**
 * Same as exportForClaude but filtered to specific annotation IDs.
 */
export function exportSelectedForClaude(session: ChatSession, annotationIds: string[]): string {
  const idSet = new Set(annotationIds);
  const filtered = session.annotations.filter(a => idSet.has(a.id) && !a.resolved);
  const grouped = groupAnnotations(filtered);
  const dateRange = getDateRange(filtered);

  let md = `# Here are my thoughts from this session\n`;
  md += `> From: ${session.chatUrl}\n`;
  md += `> Date: ${dateRange}\n`;
  md += `> Project: ${session.project}\n\n`;

  for (const type of TYPE_ORDER) {
    const items = grouped.get(type);
    if (!items || items.length === 0) continue;

    md += `## ${CLAUDE_SECTION_TITLES[type]}\n`;

    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const excerpt = truncate(a.highlightText, 200);

      if (type === 'action-item') {
        md += `- [ ] ${a.note || excerpt}`;
        if (a.note) md += ` (from: "${truncate(a.highlightText, 80)}")`;
        md += `${formatTags(a.tags)}\n`;
      } else {
        md += `${i + 1}. **"${excerpt}"**\n`;
        if (a.note) md += `   > My note: ${a.note}\n`;
        if (a.tags.length) md += `   > Tags: ${formatTags(a.tags)}\n`;
        md += '\n';
      }
    }
    md += '\n';
  }

  md += `---\n*${filtered.length} selected annotations from ${dateRange}.*\n`;
  return md;
}

function getDateRange(annotations: Annotation[]): string {
  if (annotations.length === 0) return 'N/A';
  const timestamps = annotations.map(a => a.timestamp);
  const earliest = new Date(Math.min(...timestamps));
  const latest = new Date(Math.max(...timestamps));

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (earliest.toDateString() === latest.toDateString()) {
    return fmt(earliest);
  }
  return `${fmt(earliest)} – ${fmt(latest)}`;
}
