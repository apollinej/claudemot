/**
 * Tracks the current Claude.ai chat session by extracting the chat ID from the URL.
 * Uses three layers of navigation detection:
 * 1. pushState/replaceState interception (catches most SPA navigation)
 * 2. popstate listener (catches back/forward)
 * 3. URL polling every 500ms (catches anything the above miss — Next.js
 *    can overwrite our pushState patch when its bundles load later)
 */

type SessionChangeCallback = (chatId: string | null, chatUrl: string) => void;

export class SessionTracker {
  private currentChatId: string | null = null;
  private currentUrl: string;
  private listeners: SessionChangeCallback[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.currentChatId = this.extractChatId();
    this.currentUrl = window.location.href;
    this.installNavigationInterceptors();
    this.startUrlPolling();
  }

  getChatId(): string | null {
    return this.currentChatId;
  }

  getChatUrl(): string {
    return window.location.href;
  }

  onSessionChange(callback: SessionChangeCallback): void {
    this.listeners.push(callback);
  }

  private extractChatId(): string | null {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  private handleUrlChange = (): void => {
    const newChatId = this.extractChatId();
    this.currentUrl = window.location.href;
    if (newChatId !== this.currentChatId) {
      this.currentChatId = newChatId;
      for (const listener of this.listeners) {
        listener(newChatId, window.location.href);
      }
    }
  };

  private installNavigationInterceptors(): void {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPushState(...args);
      this.handleUrlChange();
    };

    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      originalReplaceState(...args);
      this.handleUrlChange();
    };

    window.addEventListener('popstate', this.handleUrlChange);
  }

  private startUrlPolling(): void {
    this.pollInterval = setInterval(() => {
      if (window.location.href !== this.currentUrl) {
        this.handleUrlChange();
      }
    }, 500);
  }

  destroy(): void {
    window.removeEventListener('popstate', this.handleUrlChange);
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.listeners = [];
  }
}
