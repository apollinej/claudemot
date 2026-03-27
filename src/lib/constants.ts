import type { AnnotationType } from './types';

export const ANNOTATION_TYPES: { value: AnnotationType; label: string; color: string }[] = [
  { value: 'insight',     label: 'insight',      color: '#8b5cf6' },
  { value: 'question',    label: 'question',     color: '#a78bfa' },
  { value: 'action-item', label: 'action item',  color: '#7c3aed' },
  { value: 'idea',        label: 'idea',         color: '#c084fc' },
  { value: 'reference',   label: 'reference',    color: '#6366f1' },
  { value: 'issue',       label: 'issue',        color: '#ec4899' },
  { value: 'pattern',     label: 'pattern',      color: '#818cf8' },
];

export const DEFAULT_TAGS = ['architecture', 'product', 'technique', 'important'];

export const CLAUDE_SELECTORS = {
  conversationContainer: '[class*="conversation"], main [role="presentation"], main',
  messageBlock: '[data-testid*="message"], [class*="message"], [class*="Message"]',
  claudeResponse: '[data-is-streaming], [class*="assistant"], [class*="Agent"]',
  userMessage: '[class*="human"], [class*="user"], [class*="User"]',
};

export const NOTION_DEFAULTS = {
  sessionsDbId: '',
  annotationsDbId: '',
  sessionsDsId: '',
  annotationsDsId: '',
};
