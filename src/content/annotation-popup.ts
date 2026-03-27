/**
 * Floating annotation popup — draggable, pixel window style.
 */

import { ANNOTATION_TYPES } from '../lib/constants';
import { iconImg } from '../lib/icons';
import type { AnnotationType, MessageSource, SaveAnnotationPayload } from '../lib/types';

interface PopupOptions {
  rect: DOMRect;
  selectedText: string;
  source: MessageSource;
  messageIndex: number;
  chatId: string;
  chatUrl: string;
  recentTags: string[];
  onSave: (payload: SaveAnnotationPayload) => void;
  onDismiss: () => void;
}

export class AnnotationPopup {
  private container: HTMLDivElement | null = null;
  private selectedType: AnnotationType = 'insight';
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };

  show(opts: PopupOptions): void {
    this.dismiss();

    const container = document.createElement('div');
    container.id = 'claudemot-popup';
    container.className = 'ca-popup';

    const top = opts.rect.top + window.scrollY - 10;
    const left = Math.min(opts.rect.left + window.scrollX, window.innerWidth - 400);
    container.style.cssText = `
      position: absolute;
      top: ${top}px;
      left: ${Math.max(8, left)}px;
      z-index: 2147483647;
    `;

    // Read defaultAutoPin from storage, then build HTML
    this.loadDefaultAutoPin().then(defaultAutoPin => {
      container.innerHTML = this.buildHTML(opts, defaultAutoPin);
      document.body.appendChild(container);
      this.container = container;

      this.bindEvents(container, opts);
      this.makeDraggable(container);

      const noteInput = container.querySelector<HTMLTextAreaElement>('.ca-note-input');
      noteInput?.focus();

      setTimeout(() => {
        document.addEventListener('mousedown', this.handleOutsideClick);
      }, 100);
      document.addEventListener('keydown', this.handleKeyDown);
    });
  }

  dismiss(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    document.removeEventListener('mousedown', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private async loadDefaultAutoPin(): Promise<boolean> {
    try {
      const data = await chrome.storage.local.get('claudeAnnotator');
      return data.claudeAnnotator?.defaultAutoPin === true;
    } catch {
      return false;
    }
  }

  private handleOutsideClick = (e: MouseEvent): void => {
    if (this.isDragging) return;
    if (this.container && !this.container.contains(e.target as Node)) {
      this.dismiss();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.dismiss();
  };

  private makeDraggable(container: HTMLDivElement): void {
    const titlebar = container.querySelector<HTMLElement>('.ca-popup-titlebar');
    if (!titlebar) return;

    titlebar.style.cursor = 'grab';

    titlebar.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.ca-popup-titlebar-btn')) return;
      this.isDragging = true;
      titlebar.style.cursor = 'grabbing';
      const rect = container.getBoundingClientRect();
      this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging || !this.container) return;
      this.container.style.left = `${e.clientX - this.dragOffset.x + window.scrollX}px`;
      this.container.style.top = `${e.clientY - this.dragOffset.y + window.scrollY}px`;
    });

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        if (titlebar) titlebar.style.cursor = 'grab';
      }
    });
  }

  private buildHTML(opts: PopupOptions, defaultAutoPin: boolean): string {
    const excerpt = opts.selectedText;

    const defaultType = ANNOTATION_TYPES.find(t => t.value === this.selectedType)!;

    const typeButtons = ANNOTATION_TYPES.map(t => `
      <button class="ca-type-btn ${t.value === this.selectedType ? 'ca-type-active' : ''}"
              data-type="${t.value}" data-label="${t.label}" title="${t.label}">
        ${iconImg(t.value, 22)}
      </button>
    `).join('');

    const tagSuggestions = opts.recentTags.slice(0, 8).map(tag => `
      <button class="ca-tag-suggestion" data-tag="${tag}">${tag.toLowerCase()}</button>
    `).join('');

    return `
      <div class="ca-popup-inner">
        <div class="ca-popup-titlebar">
          <span class="ca-popup-titlebar-text">annotate.exe</span>
          <div class="ca-popup-titlebar-btns">
            <button class="ca-popup-titlebar-btn ca-close ca-popup-close-btn"></button>
          </div>
        </div>
        <div class="ca-popup-body">
          <div class="ca-highlight-preview">"${this.escapeHtml(excerpt)}"</div>

          <div class="ca-type-section">
            <div class="ca-type-row">
              ${typeButtons}
            </div>
            <div class="ca-type-label" id="ca-type-label">${iconImg(defaultType.value, 16)} ${defaultType.label}</div>
          </div>

          <textarea class="ca-note-input" placeholder="Add your note..." rows="2"></textarea>

          <div class="ca-tags-section">
            <input class="ca-tags-input" type="text" placeholder="tags (comma separated)" />
            <div class="ca-tag-suggestions">${tagSuggestions}</div>
          </div>

          <div class="ca-pin-toggle">
            <label class="ca-pin-label${defaultAutoPin ? ' ca-pin-active' : ''}">
              <input type="checkbox" class="ca-pin-checkbox" ${defaultAutoPin ? 'checked' : ''} />
              <span class="ca-toggle-track${defaultAutoPin ? ' ca-toggle-on' : ''}">
                <span class="ca-toggle-thumb"></span>
              </span>
              \u{1f4cc} pin to notion
            </label>
          </div>

          <div class="ca-actions">
            <button class="ca-btn ca-btn-cancel">cancel</button>
            <button class="ca-btn ca-btn-save">save</button>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(container: HTMLDivElement, opts: PopupOptions): void {
    container.querySelectorAll<HTMLButtonElement>('.ca-type-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectedType = btn.dataset.type as AnnotationType;
        container.querySelectorAll('.ca-type-btn').forEach(b => b.classList.remove('ca-type-active'));
        btn.classList.add('ca-type-active');
        const label = container.querySelector('#ca-type-label');
        if (label) label.innerHTML = `${iconImg(btn.dataset.type!, 16)} ${btn.dataset.label}`;
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.ca-tag-suggestion').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = container.querySelector<HTMLInputElement>('.ca-tags-input')!;
        const current = input.value ? input.value.split(',').map(s => s.trim()) : [];
        const tag = btn.dataset.tag!;
        if (!current.includes(tag)) {
          current.push(tag);
          input.value = current.join(', ');
        }
        btn.classList.toggle('ca-tag-selected');
      });
    });

    // Pin toggle visual state
    const pinCheckbox = container.querySelector<HTMLInputElement>('.ca-pin-checkbox');
    const pinLabel = container.querySelector<HTMLElement>('.ca-pin-label');
    const toggleTrack = container.querySelector<HTMLElement>('.ca-toggle-track');
    const syncToggleVisual = (): void => {
      if (pinCheckbox?.checked) {
        pinLabel?.classList.add('ca-pin-active');
        toggleTrack?.classList.add('ca-toggle-on');
      } else {
        pinLabel?.classList.remove('ca-pin-active');
        toggleTrack?.classList.remove('ca-toggle-on');
      }
    };
    pinCheckbox?.addEventListener('change', syncToggleVisual);

    container.querySelector('.ca-btn-save')?.addEventListener('click', (e) => {
      e.preventDefault();
      const note = container.querySelector<HTMLTextAreaElement>('.ca-note-input')!.value.trim();
      const tagsStr = container.querySelector<HTMLInputElement>('.ca-tags-input')!.value;
      const tags = tagsStr ? tagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
      const pinned = container.querySelector<HTMLInputElement>('.ca-pin-checkbox')?.checked ?? false;
      opts.onSave({
        chatId: opts.chatId, chatUrl: opts.chatUrl, highlightText: opts.selectedText,
        note, type: this.selectedType, tags, source: opts.source, messageIndex: opts.messageIndex,
        pinned,
      });
      this.dismiss();
    });

    container.querySelector('.ca-btn-cancel')?.addEventListener('click', (e) => {
      e.preventDefault(); opts.onDismiss(); this.dismiss();
    });

    container.querySelector('.ca-popup-close-btn')?.addEventListener('click', (e) => {
      e.preventDefault(); opts.onDismiss(); this.dismiss();
    });

    container.querySelector('.ca-note-input')?.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && (ke.metaKey || ke.ctrlKey)) {
        container.querySelector<HTMLButtonElement>('.ca-btn-save')?.click();
      }
    });
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
