import type { EditorState } from '@tiptap/pm/state';

export type FileKind = 'dir' | 'markdown' | 'html' | 'pdf' | 'image' | 'code' | 'text' | 'external';

export interface NativeBridge {
  postMessage: (payload: Record<string, unknown>) => void;
}

export interface TreeNodeItem {
  name: string;
  path: string;
  relPath?: string;
  isDir: boolean;
  isMarkdown: boolean;
  fileKind: FileKind;
  ext: string;
}

export interface TreeChildrenPayload {
  requestId?: string;
  dirName: string;
  dirPath: string;
  parentPath: string;
  vaultRootPath: string;
  items: TreeNodeItem[];
}

export interface TreeSearchPayload {
  requestId?: string;
  target: 'tree' | 'quickOpen';
  query: string;
  items: TreeNodeItem[];
}

export interface TabDocState {
  id: string;
  fileName: string;
  filePath: string;
  fileKind: FileKind;
  ext: string;
  previewURL: string;
  fileSize: number;
  content: string;
  hasFrontmatter: boolean;
  frontmatterValue: string;
  frontmatterOpen: boolean;
  isSourceMode: boolean;
  sourceValue: string;
  scrollTop: number;
  isDirty: boolean;
  hasExternalConflict: boolean;
  editorState: EditorState | null;
}

export interface OpenTabPayload {
  tabId: string;
  fileName: string;
  filePath: string;
  fileKind?: FileKind;
  ext?: string;
  previewURL?: string;
  fileSize?: number;
  content: string;
  activate?: boolean;
  anchor?: string;
}

export interface UpdateExternalPayload {
  tabId: string;
  fileName: string;
  filePath: string;
  fileKind?: FileKind;
  ext?: string;
  previewURL?: string;
  fileSize?: number;
  content: string;
  force?: boolean;
}

export interface AppSettingsPayload {
  themeId: string;
  accentId: string;
  fontSize: number;
  narrowWidth: boolean;
  autoSave: boolean;
  defaultVaultPath: string;
}

export interface UpdateStatePayload {
  status: 'idle' | 'checking' | 'available' | 'upToDate' | 'downloading' | 'installing' | 'error';
  currentVersion: string;
  currentBuild?: string;
  latestVersion?: string;
  tagName?: string;
  title?: string;
  body?: string;
  releaseURL?: string;
  hasUpdate: boolean;
  hasBinaryAsset?: boolean;
  bannerDismissed?: boolean;
  message?: string;
  toast?: string;
  source?: string;
}

export interface EmdiWindowAPI {
  openTab: (payload: OpenTabPayload) => void;
  openFolder: (payload: { path: string }) => void;
  activateTab: (payload: { tabId: string; anchor?: string }) => void;
  closeTab: (payload: { tabId: string; nextActiveTabId?: string }) => void;
  updateTabExternalContent: (payload: UpdateExternalPayload) => void;
  requestSave: (payload?: { tabId?: string }) => void;
  toggleSourceMode: () => void;
  toggleSidebar: () => void;
  toggleFileTree: () => void;
  toggleOutline: () => void;
  revealActiveInTree: () => void;
  toggleFocusMode: () => void;
  openQuickOpen: () => void;
  openCommandPalette: () => void;
  openSettings: (payload?: { tab?: 'appearance' | 'shortcuts' | 'releases' }) => void;
  applySettings: (payload: Partial<AppSettingsPayload>) => void;
  setChangelog: (payload: { markdown: string }) => void;
  toggleWidthMode: () => void;
  openFind: (payload: { replace?: boolean }) => void;
  navigateHistory: (payload: { delta: number }) => void;
  copyRichText: () => void;
  toggleTaskCheckbox: () => void;
  toggleHighlight: () => void;
  openLinkEditor: () => void;
  moveLine: (payload: { delta: number }) => void;
  refreshFileTree: (silent?: boolean) => void;
  adjustFontSize: (delta: number) => void;
  resetFontSize: () => void;
  markSaved: (payload: {
    tabId: string;
    fileName?: string;
    filePath?: string;
    previewURL?: string;
    silent?: boolean;
  }) => void;
  setFullScreen: (payload: { fullScreen: boolean }) => void;
  setAutoSave: (payload: { enabled: boolean }) => void;
  setPrintMode: (payload: { enabled: boolean }) => void;
  onTreeChildrenLoaded: (payload: TreeChildrenPayload) => void;
  onTreeSearchResults: (payload: TreeSearchPayload) => void;
  notifyExternalConflict: (payload: { tabId: string; fileName: string; filePath: string }) => void;
  onImageSaved: (payload: { requestId: string; relativePath: string; alt?: string }) => void;
  onImageSaveError: (payload: { requestId: string; message?: string; silent?: boolean }) => void;
  onUpdateState: (payload: UpdateStatePayload) => void;
  showToast: (payload: { message: string }) => void;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        emdi?: NativeBridge;
      };
    };
    __emdi?: EmdiWindowAPI;
  }
}
