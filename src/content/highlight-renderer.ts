/**
 * Renders highlights with a Google Docs-style comment rail on the right.
 *
 * Key design decisions:
 * - MutationObserver watches for Claude DOM re-renders and re-applies marks
 * - Single-node wrap preferred; multi-node only adds background (no border)
 * - clearAll is synchronous and idempotent — safe to call multiple times
 * - Rail cards fall back to sequenceNumber ordering when marks are missing
 */

import { ANNOTATION_TYPES } from '../lib/constants';
import { iconImg } from '../lib/icons';
import type { Annotation, AnnotationType } from '../lib/types';

const HIGHLIGHT_CLASS = 'ca-highlight';
const HIGHLIGHT_ATTR = 'data-ca-annotation-id';
const RAIL_ID = 'claudemot-rail';

type ResolveCallback = (annotationId: string) => void;

export class HighlightRenderer {
  private annotations = new Map<string, Annotation>();
  private rail: HTMLDivElement | null = null;
  private onResolve: ResolveCallback | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private scrollHandler: (() => void) | null = null;
  private mutationObserver: MutationObserver | null = null;
  private minimized = new Set<string>();
  private allMinimized = false;
  private isClearing = false;
  private isMutating = false;
  private reapplyTimeout: ReturnType<typeof setTimeout> | null = null;
  private scrollContainer: Element | null = null;

  setResolveHandler(handler: ResolveCallback): void {
    this.onResolve = handler;
  }

  getAnnotationCount(): number {
    return this.annotations.size;
  }

  addHighlight(annotation: Annotation): void {
    if (this.isClearing) return;
    this.isMutating = true;
    this.annotations.set(annotation.id, annotation);
    this.renderHighlightInDOM(annotation);
    this.rebuildRail();
    this.isMutating = false;
    this.ensureMutationObserver();
  }

  removeHighlight(annotationId: string): void {
    this.annotations.delete(annotationId);
    this.minimized.delete(annotationId);
    this.removeHighlightMarks(annotationId);
    this.rebuildRail();
  }

  updateAnnotation(annotation: Annotation): void {
    this.annotations.set(annotation.id, annotation);
    if (annotation.resolved) {
      document.querySelectorAll(
        `[${HIGHLIGHT_ATTR}="${annotation.id}"]`,
      ).forEach(m => m.classList.add('resolved'));
    }
    this.rebuildRail();
  }

  clearAll(): void {
    this.isClearing = true;

    this.annotations.clear();
    this.minimized.clear();
    this.allMinimized = false;

    // Cancel any pending reapply
    if (this.reapplyTimeout) {
      clearTimeout(this.reapplyTimeout);
      this.reapplyTimeout = null;
    }

    // Tear down all observers and listeners
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.scrollHandler) {
      const container = this.scrollContainer ?? window;
      container.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
    this.scrollContainer = null;

    // Remove rail — both our reference AND any orphaned DOM element
    if (this.rail) {
      this.rail.remove();
      this.rail = null;
    }
    document.getElementById(RAIL_ID)?.remove();

    // Unwrap all highlight marks
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent?.insertBefore(mark.firstChild, mark);
      }
      mark.remove();
    });

    this.isClearing = false;
  }

  // --- MutationObserver: re-apply highlights when Claude re-renders ---

  private ensureMutationObserver(): void {
    if (this.mutationObserver || this.annotations.size === 0) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.isClearing || this.isMutating || this.annotations.size === 0) return;
      // Ignore mutations caused by our own DOM changes (rail, marks, fab)
      const isOwnMutation = mutations.every(m => {
        const target = m.target as HTMLElement;
        return target.id === RAIL_ID
          || target.closest?.(`#${RAIL_ID}, #claudemot-fab`)
          || Array.from(m.addedNodes).every(n =>
            (n as HTMLElement).classList?.contains?.(HIGHLIGHT_CLASS)
            || (n as HTMLElement).id === RAIL_ID
          );
      });
      if (isOwnMutation) return;
      this.scheduleReapply();
    });

    // Watch the main content area for subtree changes (Claude re-renders)
    const chatContainer = document.querySelector('main') ?? document.body;
    this.mutationObserver.observe(chatContainer, {
      childList: true,
      subtree: true,
    });
  }

  private scheduleReapply(): void {
    // Debounce: Claude streams tokens rapidly, we only need to re-check
    // after the DOM settles
    if (this.reapplyTimeout) return;
    this.reapplyTimeout = setTimeout(() => {
      this.reapplyTimeout = null;
      this.reapplyMissingHighlights();
    }, 800);
  }

  private reapplyMissingHighlights(): void {
    if (this.isClearing || this.annotations.size === 0) return;

    this.isMutating = true;
    let needsRailRebuild = false;
    for (const [, annotation] of this.annotations) {
      const existing = document.querySelector(`[${HIGHLIGHT_ATTR}="${annotation.id}"]`);
      if (!existing) {
        this.renderHighlightInDOM(annotation);
        needsRailRebuild = true;
      }
    }
    if (needsRailRebuild) {
      this.rebuildRail();
    }
    this.isMutating = false;
  }

  // --- Highlight rendering ---

  private expandCard(annotationId: string): void {
    this.minimized.delete(annotationId);
    this.positionCards();
    const card = this.rail?.querySelector(`[data-annotation-id="${annotationId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('ca-highlight-flash');
      setTimeout(() => card.classList.remove('ca-highlight-flash'), 1500);
    }
  }

  private findScrollContainer(): Element {
    if (this.scrollContainer?.isConnected) return this.scrollContainer;
    // Claude uses a div.overflow-y-auto as main scroll container
    const candidates = document.querySelectorAll('*');
    for (const el of candidates) {
      const s = getComputedStyle(el);
      if (
        (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 50 &&
        el.querySelector(`.${HIGHLIGHT_CLASS}`)
      ) {
        this.scrollContainer = el;
        return el;
      }
    }
    this.scrollContainer = document.body;
    return document.body;
  }

  private getResponseContainer(): Element {
    // Prefer Claude's response area to avoid highlighting user's own text
    const candidates = [
      '[data-testid*="assistant"]',
      '[data-testid*="claude"]',
      '[class*="assistant"]',
      '[class*="Agent"]',
      'main',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  private renderHighlightInDOM(annotation: Annotation): void {
    // Skip if already rendered
    if (document.querySelector(`[${HIGHLIGHT_ATTR}="${annotation.id}"]`)) return;

    const color = this.getTypeColor(annotation.type);
    const textToFind = annotation.highlightText.slice(0, 200);
    const isResolved = annotation.resolved === true;

    // Search Claude responses first, then fall back to full page
    const responseRoot = this.getResponseContainer();
    if (this.trySingleNodeWrap(textToFind, annotation, color, isResolved, responseRoot)) {
      return;
    }
    if (this.tryMultiNodeWrap(textToFind, annotation, color, isResolved, responseRoot)) {
      return;
    }
    // Fallback to full body if not found in responses
    if (responseRoot !== document.body) {
      if (this.trySingleNodeWrap(textToFind, annotation, color, isResolved, document.body)) {
        return;
      }
      this.tryMultiNodeWrap(textToFind, annotation, color, isResolved, document.body);
    }
  }

  private trySingleNodeWrap(
    text: string,
    annotation: Annotation,
    color: string,
    isResolved: boolean,
    searchRoot: Element | Node,
  ): boolean {
    const searchStr = text.slice(0, 50);
    const walker = document.createTreeWalker(
      searchRoot,
      NodeFilter.SHOW_TEXT,
      null,
    );

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const content = node.textContent ?? '';
      const idx = content.indexOf(searchStr);
      if (idx === -1) continue;
      if (this.isOwnUI(node)) continue;

      try {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, Math.min(idx + text.length, content.length));

        const mark = this.createMark(annotation, color, isResolved, true);
        range.surroundContents(mark);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  private tryMultiNodeWrap(
    text: string,
    annotation: Annotation,
    color: string,
    isResolved: boolean,
    searchRoot: Element | Node,
  ): boolean {
    const searchStr = text.slice(0, 80);
    const nodes = this.collectTextNodes(searchRoot);

    let concat = '';
    const nodeRanges: { node: Text; startInConcat: number }[] = [];

    for (const node of nodes) {
      if (this.isOwnUI(node)) continue;
      const content = node.textContent ?? '';
      nodeRanges.push({ node, startInConcat: concat.length });
      concat += content;
    }

    const matchIdx = concat.indexOf(searchStr);
    if (matchIdx === -1) return false;

    const matchEnd = matchIdx + searchStr.length;

    const toWrap: { node: Text; wrapStart: number; wrapEnd: number }[] = [];
    for (const { node, startInConcat } of nodeRanges) {
      const content = node.textContent ?? '';
      const nodeEnd = startInConcat + content.length;
      if (nodeEnd <= matchIdx || startInConcat >= matchEnd) continue;
      toWrap.push({
        node,
        wrapStart: Math.max(0, matchIdx - startInConcat),
        wrapEnd: Math.min(content.length, matchEnd - startInConcat),
      });
    }

    for (let i = 0; i < toWrap.length; i++) {
      const { node, wrapStart, wrapEnd } = toWrap[i];
      const isLast = i === toWrap.length - 1;
      try {
        const range = document.createRange();
        range.setStart(node, wrapStart);
        range.setEnd(node, wrapEnd);
        const mark = this.createMark(annotation, color, isResolved, isLast);
        range.surroundContents(mark);
      } catch {
        // skip segment
      }
    }

    return true;
  }

  private collectTextNodes(root: Node): Text[] {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      nodes.push(node);
    }
    return nodes;
  }

  private isOwnUI(node: Node): boolean {
    const el = node.parentElement;
    if (!el) return false;
    // Skip our own extension UI
    if (el.closest(`#claudemot-popup, #claudemot-sidebar, #claudemot-fab, #${RAIL_ID}`)) {
      return true;
    }
    // Skip user input areas (reply box, contenteditable)
    if (el.closest(
      'textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"], ' +
      '[role="textbox"], .ProseMirror, .tiptap, [class*="composer"], [class*="editor"]',
    )) {
      return true;
    }
    return false;
  }

  private createMark(
    annotation: Annotation,
    color: string,
    isResolved: boolean,
    showBorder = true,
  ): HTMLElement {
    const mark = document.createElement('mark');
    mark.className = HIGHLIGHT_CLASS + (isResolved ? ' resolved' : '');
    mark.setAttribute(HIGHLIGHT_ATTR, annotation.id);
    mark.style.backgroundColor = color + (isResolved ? '0a' : '25');
    if (showBorder) {
      mark.style.borderBottom = `2px solid ${color}`;
    }
    mark.style.borderRadius = '1px';
    mark.style.padding = '0 1px';
    mark.style.cursor = 'pointer';
    if (isResolved) {
      mark.style.opacity = '0.4';
    }

    mark.addEventListener('click', (e) => {
      e.stopPropagation();
      this.expandCard(annotation.id);
    });

    return mark;
  }

  private removeHighlightMarks(annotationId: string): void {
    document
      .querySelectorAll(`[${HIGHLIGHT_ATTR}="${annotationId}"]`)
      .forEach(mark => {
        const parent = mark.parentNode;
        while (mark.firstChild) {
          parent?.insertBefore(mark.firstChild, mark);
        }
        mark.remove();
      });
  }

  // --- Comment Rail ---

  private rebuildRail(): void {
    if (this.isClearing) return;
    if (this.rail) this.rail.remove();
    if (this.annotations.size === 0) {
      this.rail = null;
      return;
    }

    const container = this.findScrollContainer();
    // Ensure container is positioned so absolute children work
    if (container !== document.body) {
      const pos = getComputedStyle(container).position;
      if (pos === 'static') {
        (container as HTMLElement).style.position = 'relative';
      }
    }

    const rail = document.createElement('div');
    rail.id = RAIL_ID;
    rail.className = 'ca-comment-rail';
    container.appendChild(rail);
    this.rail = rail;

    this.positionCards();

    if (!this.resizeObserver) {
      // Listen to the scroll container, not window
      this.scrollHandler = () => this.positionCards();
      container.addEventListener('scroll', this.scrollHandler, { passive: true });
      this.resizeObserver = new ResizeObserver(() => this.positionCards());
      this.resizeObserver.observe(container);
    }
  }

  private positionCards(): void {
    if (!this.rail || this.isClearing) return;
    this.rail.innerHTML = '';

    // Toggle all button
    const toggleAll = document.createElement('button');
    toggleAll.className = 'ca-rail-toggle-all';
    toggleAll.textContent = this.allMinimized ? '+ expand all' : '- minimize all';
    toggleAll.addEventListener('click', (e) => {
      e.stopPropagation();
      this.allMinimized = !this.allMinimized;
      if (this.allMinimized) {
        for (const id of this.annotations.keys()) this.minimized.add(id);
      } else {
        this.minimized.clear();
      }
      this.positionCards();
    });
    this.rail.appendChild(toggleAll);

    const sorted = Array.from(this.annotations.values())
      .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));

    // When ALL minimized: stack compactly at the top
    if (this.allMinimized) {
      let stackTop = 36;
      const MINI_GAP = 4;
      for (const annotation of sorted) {
        const card = this.createCard(annotation, stackTop);
        this.rail.appendChild(card);
        card.style.top = `${stackTop}px`;
        stackTop += card.offsetHeight + MINI_GAP;
      }
      return;
    }

    // When expanded: anchor each card next to its highlight mark
    const container = this.findScrollContainer();
    const containerRect = container.getBoundingClientRect();
    const scrollTop = container === document.body
      ? window.scrollY
      : container.scrollTop;

    type CardItem = { annotation: Annotation; anchorTop: number };
    const items: CardItem[] = [];
    let fallbackTop = 60;

    for (const annotation of sorted) {
      const mark = document.querySelector(
        `[${HIGHLIGHT_ATTR}="${annotation.id}"]`,
      );
      if (mark) {
        const markRect = mark.getBoundingClientRect();
        // Position relative to scroll container's content
        const top = markRect.top - containerRect.top + scrollTop;
        items.push({ annotation, anchorTop: top });
      } else {
        // No mark — still show in rail at fallback position
        items.push({ annotation, anchorTop: fallbackTop });
        fallbackTop += 100;
      }
    }

    items.sort((a, b) => a.anchorTop - b.anchorTop);

    const cards: { el: HTMLDivElement; anchorTop: number }[] = [];
    for (const item of items) {
      const card = this.createCard(item.annotation, item.anchorTop);
      this.rail.appendChild(card);
      cards.push({ el: card, anchorTop: item.anchorTop });
    }

    // Position with collision avoidance
    const applyPositions = () => {
      let lastBottom = 36;
      const MIN_GAP = 8;
      for (const { el, anchorTop } of cards) {
        let cardTop = anchorTop;
        if (cardTop < lastBottom + MIN_GAP) {
          cardTop = lastBottom + MIN_GAP;
        }
        el.style.top = `${cardTop}px`;
        lastBottom = cardTop + el.offsetHeight;
      }
    };

    applyPositions();
    requestAnimationFrame(applyPositions);
  }

  private createCard(annotation: Annotation, scrollTarget: number): HTMLDivElement {
    const typeInfo = ANNOTATION_TYPES.find(t => t.value === annotation.type)!;
    const tags = annotation.tags
      .map(t => `<span class="ca-rail-tag">#${t}</span>`)
      .join(' ');
    const note = annotation.note || '';
    const isMinimized = this.minimized.has(annotation.id);
    const isResolved = annotation.resolved === true;
    const seqBadge = `<span class="ca-rail-seq">${String(annotation.sequenceNumber ?? 0).padStart(3, '0')}</span>`;

    const card = document.createElement('div');
    card.className =
      'ca-rail-card' +
      (isMinimized ? ' minimized' : '') +
      (isResolved ? ' resolved' : '');
    card.setAttribute('data-annotation-id', annotation.id);

    if (isMinimized) {
      card.innerHTML = `
        <div class="ca-rail-card-inner">
          <div class="ca-rail-header">
            ${seqBadge}
            <span class="ca-rail-type" style="color: ${typeInfo.color}">
              ${iconImg(typeInfo.value, 16)}
            </span>
            <button class="ca-rail-minimize-btn" title="Expand">+</button>
          </div>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="ca-rail-card-inner">
          <div class="ca-rail-header">
            ${seqBadge}
            <span class="ca-rail-type" style="color: ${typeInfo.color}">
              ${iconImg(typeInfo.value, 16)} ${typeInfo.label}
            </span>
            <span class="ca-rail-card-actions">
              <button class="ca-rail-minimize-btn" title="Minimize">-</button>
            </span>
          </div>
          ${note ? `<div class="ca-rail-note${isResolved ? ' resolved-text' : ''}">${this.escapeHtml(note)}</div>` : ''}
          ${tags ? `<div class="ca-rail-tags">${tags}</div>` : ''}
          ${isResolved ? '<div class="ca-rail-resolved-badge">resolved</div>' : ''}
          <div class="ca-rail-footer">
            ${!isResolved ? `<button class="ca-rail-resolve-btn" title="Resolve">&#10003;</button>` : ''}
          </div>
        </div>
      `;
    }

    // Minimize toggle
    card.querySelector('.ca-rail-minimize-btn')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.minimized.has(annotation.id)) {
          this.minimized.delete(annotation.id);
        } else {
          this.minimized.add(annotation.id);
        }
        this.positionCards();
      });

    // Resolve button
    card.querySelector('.ca-rail-resolve-btn')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showResolveConfirmation(card, annotation);
      });

    // Click card → scroll to highlight
    card.addEventListener('click', () => {
      const mark = document.querySelector(
        `[${HIGHLIGHT_ATTR}="${annotation.id}"]`,
      );
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mark.classList.add('ca-highlight-flash');
        setTimeout(() => mark.classList.remove('ca-highlight-flash'), 1500);
        return;
      }
      // Fallback: try to find the text directly and scroll to it
      const textToFind = annotation.highlightText.slice(0, 50);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (this.isOwnUI(node)) continue;
        if ((node.textContent ?? '').includes(textToFind)) {
          node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    });

    return card;
  }

  private showResolveConfirmation(card: HTMLDivElement, annotation: Annotation): void {
    const inner = card.querySelector('.ca-rail-card-inner');
    if (!inner) return;

    inner.innerHTML = `
      <div class="ca-rail-confirm">
        <span class="ca-rail-confirm-label">resolve?</span>
        <button class="ca-rail-confirm-yes">yes</button>
        <button class="ca-rail-confirm-no">no</button>
      </div>
    `;

    inner.querySelector('.ca-rail-confirm-yes')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onResolve) this.onResolve(annotation.id);
    });

    inner.querySelector('.ca-rail-confirm-no')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.positionCards();
    });
  }

  private getTypeColor(type: AnnotationType): string {
    return ANNOTATION_TYPES.find(t => t.value === type)?.color ?? '#7c9cbf';
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
