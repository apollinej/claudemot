/**
 * Slide-in sidebar showing all annotations for the current chat session.
 * Sequential ordering, pin/export with multi-select, click to scroll.
 */

import { ANNOTATION_TYPES } from '../lib/constants';
import { iconImg } from '../lib/icons';
import type { Annotation } from '../lib/types';

const HIGHLIGHT_ATTR = 'data-ca-annotation-id';

interface SidebarOptions {
  onExport: () => void;
  onResolve: (annotationId: string) => void;
  onPin: (ids: string[]) => void;
  onExportSelected: (ids: string[]) => void;
}

type SelectMode = null | 'pin' | 'export';

export class Sidebar {
  private container: HTMLDivElement | null = null;
  private visible = false;
  private annotations: Annotation[] = [];
  private showResolved = false;
  private opts: SidebarOptions;
  private selectMode: SelectMode = null;
  private selected = new Set<string>();

  constructor(opts: SidebarOptions) {
    this.opts = opts;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    if (!this.container) this.createContainer();
    this.container!.classList.add('ca-sidebar-visible');
    this.visible = true;
    this.render();
  }

  hide(): void {
    this.container?.classList.remove('ca-sidebar-visible');
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  updateAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations;
    if (this.visible) this.render();
  }

  private createContainer(): void {
    const container = document.createElement('div');
    container.id = 'claudemot-sidebar';
    container.className = 'ca-sidebar';
    document.body.appendChild(container);
    this.container = container;
  }

  private getVisibleAnnotations(): Annotation[] {
    const list = this.showResolved
      ? this.annotations
      : this.annotations.filter(a => !a.resolved);
    // Sort by sequenceNumber ascending (oldest first)
    return list.sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
  }

  private render(): void {
    if (!this.container) return;

    const visible = this.getVisibleAnnotations();
    const totalCount = this.annotations.length;
    const resolvedCount = this.annotations.filter(a => a.resolved).length;
    const visibleCount = visible.length;

    this.container.innerHTML = `
      <div class="ca-sidebar-inner">
        <div class="ca-sidebar-header">
          <div class="ca-sidebar-title">annotations</div>
          <div class="ca-sidebar-actions">
            <span class="ca-sidebar-btn ca-sidebar-count-btn">${visibleCount}</span>
            <button class="ca-sidebar-btn ca-pin-header-btn" title="pin to notion">pin</button>
            <button class="ca-sidebar-btn ca-export-btn" title="export to clipboard">export</button>
            <button class="ca-sidebar-btn ca-close-btn" title="close sidebar">\u2715</button>
          </div>
        </div>

        ${resolvedCount > 0 ? `
          <div class="ca-sidebar-resolved-toggle">
            <label class="ca-resolved-label">
              <input type="checkbox" class="ca-resolved-checkbox" ${this.showResolved ? 'checked' : ''} />
              show resolved (${resolvedCount})
            </label>
          </div>
        ` : ''}

        <div class="ca-sidebar-body">
          ${visibleCount === 0 ? this.renderEmpty() : this.renderList(visible)}
        </div>

        ${this.selectMode ? this.renderSelectBar() : ''}
      </div>
    `;

    this.bindEvents();
  }

  private renderEmpty(): string {
    return `
      <div class="ca-sidebar-empty">
        <p>no annotations yet.</p>
        <p class="ca-sidebar-hint">
          select text in the conversation and add your first annotation.
        </p>
      </div>
    `;
  }

  private renderList(annotations: Annotation[]): string {
    return annotations.map(a => this.renderAnnotation(a)).join('');
  }

  private renderAnnotation(a: Annotation): string {
    const excerpt = a.highlightText.length > 100
      ? a.highlightText.slice(0, 100) + '...'
      : a.highlightText;
    const tags = a.tags
      .map(t => `<span class="ca-sidebar-tag">#${t}</span>`)
      .join(' ');
    const time = new Date(a.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const isResolved = a.resolved === true;
    const typeInfo = ANNOTATION_TYPES.find(t => t.value === a.type);
    const seqNum = String(a.sequenceNumber ?? 0).padStart(3, '0');
    const isChecked = this.selected.has(a.id);

    return `
      <div class="ca-sidebar-annotation${isResolved ? ' resolved' : ''}" data-id="${a.id}">
        ${this.selectMode ? `<input type="checkbox" class="ca-sidebar-checkbox" data-id="${a.id}" ${isChecked ? 'checked' : ''} />` : ''}
        <div class="ca-sidebar-annotation-content">
          <div class="ca-sidebar-annotation-header">
            <span class="ca-sidebar-seq">${seqNum}</span>
            <span class="ca-sidebar-type-icon" style="color: ${typeInfo?.color ?? '#7c9cbf'}">${iconImg(a.type, 14)} ${typeInfo?.label ?? a.type}</span>
            ${a.pinned ? '<span class="ca-sidebar-pinned-badge">\u{1f4cc}</span>' : ''}
          </div>
          <div class="ca-sidebar-highlight${isResolved ? ' resolved-text' : ''}">
            "${this.escapeHtml(excerpt)}"
          </div>
          ${a.note ? `<div class="ca-sidebar-note${isResolved ? ' resolved-text' : ''}">${this.escapeHtml(a.note)}</div>` : ''}
          <div class="ca-sidebar-meta">
            ${tags}
            <span class="ca-sidebar-time">${time}</span>
            ${!isResolved ? `<button class="ca-resolve-btn" data-id="${a.id}" title="Resolve">&#10003;</button>` : ''}
          </div>
          ${isResolved ? '<div class="ca-sidebar-resolved-badge">resolved</div>' : ''}
        </div>
      </div>
    `;
  }

  private renderSelectBar(): string {
    const count = this.selected.size;
    const actionLabel = this.selectMode === 'pin' ? 'save to notion' : 'export selected';
    const actionClass = this.selectMode === 'pin' ? 'ca-select-pin' : 'ca-select-export';

    return `
      <div class="ca-sidebar-select-bar">
        <span class="ca-select-count">${count} selected</span>
        <button class="ca-select-action ca-select-all-btn">select all</button>
        <button class="ca-select-action ${actionClass}" ${count === 0 ? 'disabled' : ''}>${actionLabel}</button>
        <button class="ca-select-cancel">cancel</button>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.container) return;

    this.container.querySelector('.ca-close-btn')
      ?.addEventListener('click', () => this.hide());

    // Export all (original behavior)
    this.container.querySelector('.ca-export-btn')
      ?.addEventListener('click', () => {
        if (this.selectMode === 'export') {
          // Already in export select mode, cancel
          this.exitSelectMode();
        } else {
          this.enterSelectMode('export');
        }
      });

    // Pin header button
    this.container.querySelector('.ca-pin-header-btn')
      ?.addEventListener('click', () => {
        if (this.selectMode === 'pin') {
          this.exitSelectMode();
        } else {
          this.enterSelectMode('pin');
        }
      });

    // Resolved toggle
    this.container.querySelector('.ca-resolved-checkbox')
      ?.addEventListener('change', (e) => {
        this.showResolved = (e.target as HTMLInputElement).checked;
        this.render();
      });

    // Resolve buttons
    this.container.querySelectorAll<HTMLButtonElement>('.ca-resolve-btn')
      .forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.opts.onResolve(btn.dataset.id!);
        });
      });

    // Click annotation card → scroll to highlight
    this.container.querySelectorAll<HTMLElement>('.ca-sidebar-annotation')
      .forEach(card => {
        card.addEventListener('click', (e) => {
          // Don't scroll if clicking a button or checkbox
          const target = e.target as HTMLElement;
          if (target.closest('button, input[type="checkbox"]')) return;

          const id = card.dataset.id;
          if (!id) return;

          if (this.selectMode) {
            // In select mode, toggle checkbox
            this.toggleSelection(id);
            return;
          }

          // Scroll to highlight
          const mark = document.querySelector(`[${HIGHLIGHT_ATTR}="${id}"]`);
          if (mark) {
            mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            mark.classList.add('ca-highlight-flash');
            setTimeout(() => mark.classList.remove('ca-highlight-flash'), 1500);
          }
        });
      });

    // Checkboxes in select mode
    this.container.querySelectorAll<HTMLInputElement>('.ca-sidebar-checkbox')
      .forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.dataset.id!;
          if (cb.checked) this.selected.add(id);
          else this.selected.delete(id);
          this.render();
        });
      });

    // Select bar buttons
    this.container.querySelector('.ca-select-all-btn')
      ?.addEventListener('click', () => {
        const visible = this.getVisibleAnnotations();
        for (const a of visible) this.selected.add(a.id);
        this.render();
      });

    this.container.querySelector('.ca-select-cancel')
      ?.addEventListener('click', () => this.exitSelectMode());

    // Action button (pin or export)
    this.container.querySelector('.ca-select-pin')
      ?.addEventListener('click', () => {
        if (this.selected.size === 0) return;
        this.opts.onPin(Array.from(this.selected));
        this.exitSelectMode();
      });

    this.container.querySelector('.ca-select-export')
      ?.addEventListener('click', () => {
        if (this.selected.size === 0) return;
        this.opts.onExportSelected(Array.from(this.selected));
        this.exitSelectMode();
      });
  }

  private toggleSelection(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.render();
  }

  private enterSelectMode(mode: SelectMode): void {
    this.selectMode = mode;
    this.selected.clear();
    this.render();
  }

  private exitSelectMode(): void {
    this.selectMode = null;
    this.selected.clear();
    this.render();
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
