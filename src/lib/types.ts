// --- Annotation types ---

export type AnnotationType =
  | 'insight'
  | 'question'
  | 'action-item'
  | 'reference'
  | 'issue'
  | 'idea'
  | 'pattern';

export type MessageSource = 'claude-response' | 'user-message' | 'artifact';

export interface Annotation {
  id: string; // local UUID
  chatId: string;
  highlightText: string;
  note: string;
  type: AnnotationType;
  tags: string[];
  source: MessageSource;
  messageIndex: number;
  timestamp: number;
  sequenceNumber: number;
  pinned: boolean;
  // Notion sync state
  notionPageId?: string;
  synced: boolean;
  // Resolve state
  resolved?: boolean;
}

export interface ChatSession {
  chatId: string;
  chatUrl: string;
  title: string;
  project: string;
  notionPageId?: string;
  createdAt: number;
  annotations: Annotation[];
}

// --- Messages between content script and service worker ---

export type MessageType =
  | 'SAVE_ANNOTATION'
  | 'GET_SESSION'
  | 'GET_ANNOTATIONS'
  | 'DELETE_ANNOTATION'
  | 'UPDATE_ANNOTATION'
  | 'RESOLVE_ANNOTATION'
  | 'EXPORT_SESSION'
  | 'SYNC_STATUS'
  | 'OPEN_OPTIONS'
  | 'PIN_ANNOTATIONS'
  | 'EXPORT_SELECTED'
  | 'CLEAR_ALL_DATA'
  | 'SETUP_NOTION'
  | 'SEARCH_NOTION_DATABASES'
  | 'GET_ACCESSIBLE_PAGES'
  | 'CREATE_NOTION_DATABASES';

export interface SaveAnnotationPayload {
  chatId: string;
  chatUrl: string;
  highlightText: string;
  note: string;
  type: AnnotationType;
  tags: string[];
  source: MessageSource;
  messageIndex: number;
  pinned?: boolean;
}

export interface PinAnnotationsPayload {
  chatId: string;
  annotationIds: string[];
}

export interface ExportSelectedPayload {
  chatId: string;
  annotationIds: string[];
}

export interface ExtensionMessage {
  type: MessageType;
  payload?: SaveAnnotationPayload
    | { chatId: string }
    | { id: string; chatId: string }
    | { annotation: Annotation }
    | PinAnnotationsPayload
    | ExportSelectedPayload;
}

export interface ExtensionResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// --- Notion config ---

export interface NotionConfig {
  apiKey: string;
  sessionsDbId: string;
  annotationsDbId: string;
  sessionsDsId: string;   // data source (collection) ID
  annotationsDsId: string; // data source (collection) ID
}

// --- Notion setup ---

export interface NotionSetupResult {
  sessionsDbId: string;
  annotationsDbId: string;
  sessionsDsId: string;
  annotationsDsId: string;
  parentPageTitle: string;
}

export interface NotionAccessiblePage {
  id: string;
  title: string;
  icon?: string;
}

// --- Storage shape ---

export interface StorageData {
  notionConfig?: NotionConfig;
  sessions: Record<string, ChatSession>;
  defaultProject: string;
  recentTags: string[];
  defaultAutoPin?: boolean;
}
