import './style.css';
import { Editor } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Markdown } from 'tiptap-markdown';

import type { AppSettingsPayload, FileKind, OpenTabPayload, TabDocState, UpdateExternalPayload, UpdateStatePayload } from './types';
import {
  IMAGE_EXT_RE,
  joinFrontmatter,
  preprocessMarkdownForEditor,
  splitFrontmatter,
} from './markdown-preprocess';
import {
  CalloutDecorator,
  EmdiCodeBlock,
  EmdiHighlight,
  EmdiImage,
  EmdiWikiLink,
  InlineCodeUrlDecorator,
  SearchHighlight,
  setExtensionProviders,
  setMermaidThemeMode,
} from './extensions';
import { FindReplaceController } from './ui/find-replace';
import { FloatingToolsController } from './ui/floating-tools';
import { FileTreeController } from './ui/file-tree';
import { CommandPaletteController, type CommandItem } from './ui/command-palette';
import { SettingsModalController } from './ui/settings-modal';
import { FeedbackModalController } from './ui/feedback-modal';
import { InspectorController } from './ui/inspector';
import { configureDataviewBridge, handleDataviewResult } from './ui/dataview';
import { applyThemePalette } from './ui/themes';
import { formatFileSize, getFileIconSVG } from './ui/file-icons';
import { renderCodeOrDataPreview } from './ui/code-preview';

// ── DOM References ──

const appEl = document.getElementById('app') as HTMLDivElement;
const sidebarHeaderEl = document.getElementById('sidebar-header') as HTMLDivElement;
const btnSidebarCollapse = document.getElementById('btn-sidebar-collapse') as HTMLButtonElement;
const btnSidebarOpen = document.getElementById('btn-sidebar-open') as HTMLButtonElement;
const outlineListEl = document.getElementById('outline-list') as HTMLElement;

const tabbarEl = document.getElementById('tabbar') as HTMLElement;
const tabStripEl = document.getElementById('tab-strip') as HTMLDivElement;
const btnNewTab = document.getElementById('btn-new-tab') as HTMLButtonElement;
const tabbarDragSpacer = document.getElementById('tabbar-drag-spacer') as HTMLDivElement;
const btnOpenDefault = document.getElementById('btn-open-default') as HTMLButtonElement;
const btnQuickOpen = document.getElementById('btn-quick-open') as HTMLButtonElement;
const btnFind = document.getElementById('btn-find') as HTMLButtonElement;
const btnWidth = document.getElementById('btn-width') as HTMLButtonElement;
const tabbarActionSep = document.getElementById('tabbar-action-sep') as HTMLSpanElement;
const btnMode = document.getElementById('btn-mode') as HTMLButtonElement;
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;

const btnNavBack = document.getElementById('btn-nav-back') as HTMLButtonElement;
const btnNavForward = document.getElementById('btn-nav-forward') as HTMLButtonElement;
const fileBreadcrumbEl = document.getElementById('file-breadcrumb') as HTMLButtonElement;
const statusToastEl = document.getElementById('status-toast') as HTMLSpanElement;
const btnAutoSave = document.getElementById('btn-autosave') as HTMLButtonElement;
const btnUpdatePill = document.getElementById('btn-update-pill') as HTMLButtonElement;
const btnVersionCheck = document.getElementById('btn-version-check') as HTMLButtonElement;
const docStatsEl = document.getElementById('doc-stats') as HTMLSpanElement;

const externalBannerEl = document.getElementById('external-banner') as HTMLElement;
const btnExternalReload = document.getElementById('btn-external-reload') as HTMLButtonElement;
const btnExternalKeep = document.getElementById('btn-external-keep') as HTMLButtonElement;

const sidebarUpdateCardEl = document.getElementById('sidebar-update-card') as HTMLDivElement;
const sucTitleEl = document.getElementById('suc-title') as HTMLSpanElement;
const sucDescEl = document.getElementById('suc-desc') as HTMLParagraphElement;
const btnUpdateInstall = document.getElementById('btn-update-install') as HTMLButtonElement;
const btnUpdateNotes = document.getElementById('btn-update-notes') as HTMLButtonElement;
const btnUpdateDismiss = document.getElementById('btn-update-dismiss') as HTMLButtonElement;
const btnSidebarSettings = document.getElementById('btn-sidebar-settings') as HTMLButtonElement;
const btnSidebarShortcuts = document.getElementById('btn-sidebar-shortcuts') as HTMLButtonElement;
const btnSidebarFeedback = document.getElementById('btn-sidebar-feedback') as HTMLButtonElement;

const editorScrollEl = document.getElementById('editor-scroll') as HTMLElement;
const documentContainerEl = document.querySelector('.document-container') as HTMLElement;
const frontmatterCard = document.getElementById('frontmatter-card') as HTMLElement;
const frontmatterToggle = document.getElementById('frontmatter-toggle') as HTMLButtonElement;
const frontmatterBody = document.getElementById('frontmatter-body') as HTMLElement;
const frontmatterTextarea = document.getElementById('frontmatter-textarea') as HTMLTextAreaElement;
const fmPreview = document.getElementById('fm-preview') as HTMLSpanElement;
const richEditorEl = document.getElementById('rich-editor') as HTMLDivElement;
const codePreviewEl = document.getElementById('code-preview') as HTMLDivElement;
const sourceEditorEl = document.getElementById('source-editor') as HTMLTextAreaElement;

const htmlStageEl = document.getElementById('html-stage') as HTMLDivElement;
const htmlPreviewFrame = document.getElementById('html-preview-frame') as HTMLIFrameElement;
const pdfStageEl = document.getElementById('pdf-stage') as HTMLDivElement;
const pdfPreviewFrame = document.getElementById('pdf-preview-frame') as HTMLIFrameElement;
const imageStageEl = document.getElementById('image-stage') as HTMLDivElement;
const imageStageMetaEl = document.getElementById('image-stage-meta') as HTMLSpanElement;
const imageZoomLabelEl = document.getElementById('image-zoom-label') as HTMLSpanElement;
const btnImgZoomOut = document.getElementById('btn-img-zoom-out') as HTMLButtonElement;
const btnImgZoomIn = document.getElementById('btn-img-zoom-in') as HTMLButtonElement;
const btnImgFit = document.getElementById('btn-img-fit') as HTMLButtonElement;
const imageTabPreviewEl = document.getElementById('image-tab-preview') as HTMLImageElement;

const tabContextMenuEl = document.getElementById('tab-context-menu') as HTMLDivElement;
const linkTooltipEl = document.getElementById('link-tooltip') as HTMLDivElement;
const lightboxEl = document.getElementById('lightbox') as HTMLDivElement;
const lightboxImgEl = document.getElementById('lightbox-img') as HTMLImageElement;
const lightboxCaptionEl = document.getElementById('lightbox-caption') as HTMLDivElement;
const lightboxCloseBtn = document.getElementById('lightbox-close') as HTMLButtonElement;

// ── State ──

let tabs: TabDocState[] = [];
let activeTabId: string | null = null;
let tabHistory: string[] = [];
let tabHistoryIndex = -1;
let isNavigatingHistory = false;

let suppressDirty = false;
let currentFontSize = 15.5;
let toastTimer: number | undefined;
let autoSaveTimer: number | undefined;
let autoSaveEnabled = false;
let imageReloadNonce = 1;
let contextMenuTabId: string | null = null;
let outlineHeadings: { level: number; text: string; element: HTMLElement; btn: HTMLButtonElement }[] = [];

// Image tab zoom state (null = fit)
let imageZoomPct: number | null = null;

// Focus mode state (Paseo Cmd+Shift+F)
let focusModeActive = false;
let preFocusSidebarOpen = true;
let preFocusNarrowWidth = false;
let latestUpdateState: UpdateStatePayload | null = null;

// Theme & Preferences state (synced with native UserDefaults)
let currentThemeId = 'lavender';
let currentAccentId = 'auto';
let defaultVaultPath = '';

function applyThemeAndNotify(themeId: string, accentId: string, persist = true) {
  const palette = applyThemePalette(themeId, accentId);
  currentThemeId = palette.id;
  currentAccentId = accentId;
  setMermaidThemeMode(palette.mode === 'light');
  try {
    window.localStorage.setItem('emdi:themeId', palette.id);
    window.localStorage.setItem('emdi:accentId', accentId);
  } catch {
    // Ignore
  }
  if (persist) {
    postNative({
      type: 'saveSettings',
      themeId: palette.id,
      accentId,
      themeMode: palette.mode,
      windowBgHex: palette.windowBgHex,
    });
  }
}

try {
  const initialTheme = window.localStorage.getItem('emdi:themeId') || 'lavender';
  const initialAccent = window.localStorage.getItem('emdi:accentId') || 'auto';
  applyThemeAndNotify(initialTheme, initialAccent, false);
} catch {
  applyThemeAndNotify('lavender', 'auto', false);
}

const isMacPlatform = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
document.documentElement.dataset.platform = isMacPlatform ? 'macos' : 'windows';

function postNative(payload: Record<string, unknown>) {
  if (window.webkit?.messageHandlers?.emdi) {
    window.webkit.messageHandlers.emdi.postMessage(payload);
    return;
  }
  const tauri = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  if (tauri?.invoke) {
    tauri.invoke('emdi_message', { payload }).catch((err) => {
      console.error('[emdi] native invoke error:', err);
    });
  }
}

function getActiveTab(): TabDocState | null {
  if (!activeTabId) return tabs[0] ?? null;
  return tabs.find((t) => t.id === activeTabId) ?? null;
}

function isEditableTextKind(kind: FileKind): boolean {
  return kind === 'markdown' || kind === 'html' || kind === 'code' || kind === 'text';
}

function showToast(message: string, duration = 2200) {
  statusToastEl.textContent = message;
  statusToastEl.classList.add('visible');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    statusToastEl.classList.remove('visible');
  }, duration);
}

setExtensionProviders({
  getImageContext: () => ({ tabId: activeTabId ?? '', nonce: imageReloadNonce }),
  onCopyText: (text: string) => {
    postNative({ type: 'copyText', text });
    showToast('코드 복사됨', 1500);
  },
  onOpenFilePath: (path: string) => postNative({ type: 'openFilePath', path }),
});

configureDataviewBridge({
  postNative,
  getActiveTabId: () => activeTabId ?? '',
});

const fileTree = new FileTreeController({
  postNative,
  getActiveFilePath: () => getActiveTab()?.filePath ?? '',
  getOpenTabFiles: () =>
    tabs.map((t) => ({ fileName: t.fileName, filePath: t.filePath, fileKind: t.fileKind, ext: t.ext })),
  showToast,
});

const inspector = new InspectorController({
  postNative,
  getActiveTabInfo: () => {
    const tab = getActiveTab();
    return tab ? { filePath: tab.filePath, fileName: tab.fileName, fileKind: tab.fileKind } : null;
  },
  getRichEditorEl: () => richEditorEl,
  onOutlineRefresh: () => updateOutline(),
  onOpenLink: (target, isWiki) => {
    if (target.startsWith('#')) {
      scrollToAnchor(target.slice(1));
    } else {
      postNative({ type: 'openLink', target, isWiki, tabId: activeTabId ?? '' });
    }
  },
});

// ── Editor Setup ──

let imageRequestSeq = 0;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(file: File) {
  try {
    const dataBase64 = await readFileAsBase64(file);
    const requestId = `img-${Date.now()}-${++imageRequestSeq}`;
    const rawName = file.name ? file.name.replace(/\.[^.]+$/, '') : '';
    const alt = rawName && rawName.toLowerCase() !== 'image' ? rawName : '';
    postNative({
      type: 'saveImage',
      requestId,
      tabId: activeTabId ?? '',
      dataBase64,
      alt,
    });
  } catch {
    showToast('이미지를 읽을 수 없습니다');
  }
}

function insertImageAtCursor(relativePath: string, alt = '') {
  const tab = getActiveTab();
  if (!tab || tab.fileKind !== 'markdown') return;
  if (tab.isSourceMode) {
    const snippet = `![${alt}](${relativePath})`;
    const start = sourceEditorEl.selectionStart ?? sourceEditorEl.value.length;
    const end = sourceEditorEl.selectionEnd ?? start;
    const val = sourceEditorEl.value;
    sourceEditorEl.value = val.slice(0, start) + snippet + val.slice(end);
    const nextPos = start + snippet.length;
    sourceEditorEl.selectionStart = nextPos;
    sourceEditorEl.selectionEnd = nextPos;
    autoResizeSource();
    markActiveDirty(true);
    updateDocStats();
    showToast('이미지 삽입됨');
    return;
  }

  editor.chain().focus().setImage({ src: relativePath, alt }).run();
  showToast('이미지 삽입됨');
}

const editor: Editor = new Editor({
  element: richEditorEl,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: false,
    }),
    EmdiCodeBlock,
    EmdiHighlight,
    EmdiWikiLink,
    CalloutDecorator,
    InlineCodeUrlDecorator,
    SearchHighlight,
    EmdiImage.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: {
        class: 'emdi-image',
        loading: 'lazy',
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false, renderWrapper: true }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        rel: 'noopener noreferrer',
      },
    }),
    Placeholder.configure({
      placeholder: '바로 작성을 시작하거나 파일을 열어보세요  ·  / 블록 삽입  ·  ⌘O 파일 열기  ·  ⌘⌥O 폴더 열기',
    }),
    Typography,
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: '-',
      linkify: true,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
  ],
  editorProps: {
    clipboardTextSerializer: (slice) => {
      const rows: string[] = [];
      let hasTable = false;
      slice.content.descendants((node) => {
        if (node.type.name === 'tableRow') {
          hasTable = true;
          const cells: string[] = [];
          node.forEach((cell) => {
            cells.push(cell.textBetween(0, cell.content.size, '\n', '\n').trim());
          });
          rows.push(cells.join('\t'));
          return false;
        }
        return true;
      });
      if (hasTable) {
        return rows.join('\n');
      }
      return slice.content.textBetween(0, slice.content.size, '\n\n', '\n');
    },
    handleKeyDown: (_view, event): boolean => {
      return floatingTools.handleKeyDown(event);
    },
    handlePaste: (_view, event) => {
      const items = event.clipboardData?.items;
      if (items) {
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }
        if (imageFiles.length > 0) {
          event.preventDefault();
          for (const file of imageFiles) {
            void uploadImageFile(file);
          }
          return true;
        }
      }

      const hasText = Boolean(event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text/html'));
      if (!hasText) {
        const requestId = `native-paste-${Date.now()}-${++imageRequestSeq}`;
        postNative({ type: 'pasteNativeImage', requestId, tabId: activeTabId ?? '' });
      }
      return false;
    },
    handleDrop: (_view, event) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return false;
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/') || IMAGE_EXT_RE.test(f.name));
      if (imageFiles.length === 0) return false;
      event.preventDefault();
      editorScrollEl.classList.remove('drop-active');
      for (const file of imageFiles) {
        void uploadImageFile(file);
      }
      return true;
    },
  },
  content: '',
  onUpdate: () => {
    if (!suppressDirty) {
      markActiveDirty(true);
    }
    updateDocStats();
    updateOutline();
  inspector.refreshAll(false);
  },
});

const findReplace = new FindReplaceController({
  editor,
  sourceEditorEl,
  isSourceMode: () => {
    const tab = getActiveTab();
    if (!tab) return false;
    return tab.isSourceMode || tab.fileKind !== 'markdown';
  },
  onSourceMutated: () => {
    autoResizeSource();
    markActiveDirty(true);
    updateDocStats();
  },
  showToast,
});

const floatingTools = new FloatingToolsController({
  editor,
  isSourceMode: () => {
    const tab = getActiveTab();
    return !tab || tab.fileKind !== 'markdown' || tab.isSourceMode;
  },
  editorScrollEl,
});

// ── Serialization & Frontmatter ──

function getMarkdownFromEditor(tab: TabDocState): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = editor.storage as any;
  const body: string = storage.markdown?.getMarkdown?.() ?? editor.getText();
  return joinFrontmatter(tab.hasFrontmatter, tab.frontmatterValue, body);
}

function getTabFullContent(tab: TabDocState): string {
  if (tab.id === activeTabId) {
    if (tab.fileKind === 'markdown') {
      return tab.isSourceMode ? sourceEditorEl.value : getMarkdownFromEditor(tab);
    }
    if (tab.fileKind === 'html' || tab.fileKind === 'code' || tab.fileKind === 'text') {
      return tab.isSourceMode ? sourceEditorEl.value : tab.sourceValue;
    }
  }
  return tab.content;
}

function updateFrontmatterPreview(fm: string) {
  const lines = fm
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  fmPreview.textContent = lines.slice(0, 3).join('   ');
}

function renderFrontmatterUI(tab: TabDocState) {
  if (tab.fileKind !== 'markdown' || !tab.hasFrontmatter || tab.isSourceMode) {
    frontmatterCard.classList.add('hidden');
    frontmatterCard.classList.remove('open');
    frontmatterBody.classList.add('hidden');
    return;
  }
  frontmatterCard.classList.remove('hidden');
  frontmatterCard.classList.toggle('open', tab.frontmatterOpen);
  frontmatterBody.classList.toggle('hidden', !tab.frontmatterOpen);
  frontmatterTextarea.value = tab.frontmatterValue;
  updateFrontmatterPreview(tab.frontmatterValue);
}

// ── Dirty & Auto-Save ──

function markActiveDirty(dirty: boolean) {
  const tab = getActiveTab();
  if (!tab || !isEditableTextKind(tab.fileKind)) return;
  if (tab.isDirty !== dirty) {
    tab.isDirty = dirty;
    postNative({ type: 'dirtyChanged', tabId: tab.id, dirty });
    renderTabStrip();
  }
  if (dirty && autoSaveEnabled && tab.filePath) {
    scheduleAutoSave(tab.id);
  }
}

function scheduleAutoSave(tabId: string) {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || !tab.isDirty || !tab.filePath || !autoSaveEnabled) return;
    const content = getTabFullContent(tab);
    postNative({ type: 'save', tabId: tab.id, content, autoSave: true });
  }, 1500);
}

// ── Document Stats & Outline ──

function updateDocStats() {
  const tab = getActiveTab();
  if (!tab) {
    docStatsEl.textContent = '';
    return;
  }

  if (tab.fileKind === 'pdf' || tab.fileKind === 'image') {
    const sizeText = formatFileSize(tab.fileSize);
    const label = tab.ext ? tab.ext.toUpperCase() : tab.fileKind.toUpperCase();
    docStatsEl.textContent = sizeText ? `${label} · ${sizeText}` : label;
    return;
  }

  if (tab.fileKind === 'html' || tab.fileKind === 'code' || tab.fileKind === 'text') {
    const val = tab.isSourceMode ? sourceEditorEl.value : tab.sourceValue;
    const lines = val ? val.split(/\r?\n/).length : 0;
    const sizeText = formatFileSize(tab.fileSize || new Blob([val]).size);
    const label = tab.ext ? tab.ext.toUpperCase() : tab.fileKind.toUpperCase();
    docStatsEl.textContent = `${label} · ${lines.toLocaleString()}줄${sizeText ? ` · ${sizeText}` : ''}`;
    return;
  }

  const text = tab.isSourceMode ? sourceEditorEl.value : editor.getText();
  const charCount = text.replace(/\s+/g, '').length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const readMin = Math.max(1, Math.ceil(charCount / 450));
  docStatsEl.textContent =
    charCount > 0 ? `${charCount.toLocaleString()}자 · ${wordCount.toLocaleString()}단어 · 약 ${readMin}분` : '0자';
}

function updateOutline() {
  outlineHeadings = [];
  outlineListEl.innerHTML = '';

  const tab = getActiveTab();
  if (!tab || tab.fileKind !== 'markdown') {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = '마크다운 문서에서 목차가 표시됩니다';
    outlineListEl.appendChild(empty);
    return;
  }

  const domHeadings = richEditorEl.querySelectorAll('h1, h2, h3, h4');
  const validNodes: { level: number; text: string; element: HTMLElement }[] = [];
  domHeadings.forEach((node) => {
    const el = node as HTMLElement;
    const text = el.textContent?.trim() ?? '';
    if (!text) return;
    const level = Number(el.tagName.slice(1));
    validNodes.push({ level, text, element: el });
  });

  if (validNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = '제목이 없습니다';
    outlineListEl.appendChild(empty);
    return;
  }

  for (const h of validNodes) {
    const btn = document.createElement('button');
    btn.className = `outline-item level-${h.level}`;
    btn.type = 'button';
    btn.textContent = h.text;
    btn.title = h.text;
    btn.addEventListener('click', () => {
      h.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    outlineListEl.appendChild(btn);
    outlineHeadings.push({ ...h, btn });
  }
  highlightActiveOutlineHeading();
}

function highlightActiveOutlineHeading() {
  if (outlineHeadings.length === 0) return;
  const scrollRect = editorScrollEl.getBoundingClientRect();
  let activeIdx = 0;
  for (let i = 0; i < outlineHeadings.length; i++) {
    const rect = outlineHeadings[i].element.getBoundingClientRect();
    if (rect.top - scrollRect.top <= 90) {
      activeIdx = i;
    } else {
      break;
    }
  }
  outlineHeadings.forEach((item, idx) => {
    item.btn.classList.toggle('active', idx === activeIdx);
  });
}

function normalizeAnchorText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function scrollToAnchor(anchor: string) {
  const targetNorm = normalizeAnchorText(anchor);
  const rawLower = anchor.trim().toLowerCase();
  const headings = richEditorEl.querySelectorAll('h1, h2, h3, h4');
  for (const node of Array.from(headings)) {
    const el = node as HTMLElement;
    const txt = (el.textContent ?? '').trim();
    if (txt.toLowerCase() === rawLower || normalizeAnchorText(txt) === targetNorm) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('anchor-flash');
      window.setTimeout(() => el.classList.remove('anchor-flash'), 1200);
      return true;
    }
  }
  return false;
}

// ── Image Tab Zoom ──

function applyImageZoom() {
  if (imageZoomPct === null) {
    imageTabPreviewEl.classList.remove('zoomed');
    imageTabPreviewEl.style.width = '';
    imageZoomLabelEl.textContent = '맞춤';
  } else {
    imageTabPreviewEl.classList.add('zoomed');
    const naturalW = imageTabPreviewEl.naturalWidth || 800;
    imageTabPreviewEl.style.width = `${Math.round((naturalW * imageZoomPct) / 100)}px`;
    imageZoomLabelEl.textContent = `${imageZoomPct}%`;
  }
}

btnImgZoomIn.addEventListener('click', () => {
  imageZoomPct = Math.min(300, (imageZoomPct ?? 100) + 25);
  applyImageZoom();
});

btnImgZoomOut.addEventListener('click', () => {
  imageZoomPct = Math.max(25, (imageZoomPct ?? 100) - 25);
  applyImageZoom();
});

btnImgFit.addEventListener('click', () => {
  imageZoomPct = null;
  applyImageZoom();
});

imageTabPreviewEl.addEventListener('load', () => {
  const tab = getActiveTab();
  if (!tab || tab.fileKind !== 'image') return;
  const dims = `${imageTabPreviewEl.naturalWidth} × ${imageTabPreviewEl.naturalHeight}px`;
  const size = formatFileSize(tab.fileSize);
  imageStageMetaEl.textContent = size ? `${tab.fileName} · ${dims} · ${size}` : `${tab.fileName} · ${dims}`;
});

imageTabPreviewEl.addEventListener('click', () => {
  if (imageTabPreviewEl.src) {
    openLightbox(imageTabPreviewEl.src, getActiveTab()?.fileName ?? '');
  }
});

// ── Tab State & Multi-Format Stage Switching ──

function createFreshEditorStateForBody(bodyMarkdown: string): EditorState {
  suppressDirty = true;
  const blank = EditorState.create({
    schema: editor.schema,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(blank);
  editor.commands.setContent(preprocessMarkdownForEditor(bodyMarkdown), false);
  const clean = EditorState.create({
    doc: editor.state.doc,
    schema: editor.schema,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(clean);
  suppressDirty = false;
  return editor.state;
}

function snapshotCurrentTab() {
  const cur = getActiveTab();
  if (!cur) return;
  cur.scrollTop = editorScrollEl.scrollTop;
  cur.frontmatterOpen = frontmatterCard.classList.contains('open');
  if (cur.fileKind === 'markdown') {
    if (cur.isSourceMode) {
      cur.sourceValue = sourceEditorEl.value;
      cur.content = sourceEditorEl.value;
    } else {
      cur.editorState = editor.state;
      cur.content = getMarkdownFromEditor(cur);
    }
  } else if (cur.fileKind === 'html' || cur.fileKind === 'code' || cur.fileKind === 'text') {
    if (cur.isSourceMode) {
      cur.sourceValue = sourceEditorEl.value;
      cur.content = sourceEditorEl.value;
    }
  }
}

function pushTabHistory(tabId: string) {
  if (isNavigatingHistory) return;
  if (tabHistory[tabHistoryIndex] === tabId) return;
  tabHistory = tabHistory.slice(0, tabHistoryIndex + 1);
  tabHistory.push(tabId);
  if (tabHistory.length > 50) {
    tabHistory.shift();
  }
  tabHistoryIndex = tabHistory.length - 1;
  updateNavButtons();
}

function updateNavButtons() {
  btnNavBack.disabled = tabHistoryIndex <= 0;
  btnNavForward.disabled = tabHistoryIndex < 0 || tabHistoryIndex >= tabHistory.length - 1;
}

function navigateHistory(delta: number) {
  const nextIdx = tabHistoryIndex + delta;
  if (nextIdx < 0 || nextIdx >= tabHistory.length) return;
  const targetId = tabHistory[nextIdx];
  if (!tabs.some((t) => t.id === targetId)) return;
  tabHistoryIndex = nextIdx;
  isNavigatingHistory = true;
  activateTabLocal(targetId, undefined, true);
  isNavigatingHistory = false;
  updateNavButtons();
}

function formatBreadcrumb(filePath: string, fileName: string): string {
  if (!filePath) return fileName || '제목 없음.md';
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 3) return parts.join(' / ');
  return `… / ${parts.slice(-3).join(' / ')}`;
}

function withCacheBust(url: string): string {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${imageReloadNonce}`;
}

function syncToolbarForTab(tab: TabDocState) {
  const editable = isEditableTextKind(tab.fileKind);
  const isMd = tab.fileKind === 'markdown';
  const isBinary = tab.fileKind === 'pdf' || tab.fileKind === 'image';

  btnOpenDefault.classList.toggle('hidden', isMd || !tab.filePath);
  btnFind.classList.toggle('hidden', isBinary);
  btnWidth.classList.toggle('hidden', isBinary || (tab.fileKind === 'html' && !tab.isSourceMode));
  tabbarActionSep.classList.toggle('hidden', isBinary);
  btnMode.classList.toggle('hidden', isBinary);
  btnSave.classList.toggle('hidden', !editable);

  if (tab.fileKind === 'markdown') {
    btnMode.textContent = tab.isSourceMode ? '미리보기' : '원문';
    btnMode.classList.toggle('active', tab.isSourceMode);
  } else if (tab.fileKind === 'html') {
    btnMode.textContent = tab.isSourceMode ? '미리보기' : '코드 편집';
    btnMode.classList.toggle('active', tab.isSourceMode);
  } else if (tab.fileKind === 'code' || tab.fileKind === 'text') {
    btnMode.textContent = tab.isSourceMode ? '보기' : '편집';
    btnMode.classList.toggle('active', tab.isSourceMode);
  }
}

function mountTabToView(tab: TabDocState, anchor?: string, preserveScroll = false) {
  const savedScroll = preserveScroll ? editorScrollEl.scrollTop : tab.scrollTop;
  imageReloadNonce += 1;
  activeTabId = tab.id;
  floatingTools.hideAll();

  document.title = tab.fileName || '엠디';
  fileBreadcrumbEl.textContent = formatBreadcrumb(tab.filePath, tab.fileName);
  fileBreadcrumbEl.title = tab.filePath ? `${tab.filePath} (클릭하여 경로 복사)` : tab.fileName;
  externalBannerEl.classList.toggle('hidden', !tab.hasExternalConflict);

  // Hide all stages first
  editorScrollEl.classList.add('hidden');
  htmlStageEl.classList.add('hidden');
  pdfStageEl.classList.add('hidden');
  imageStageEl.classList.add('hidden');
  richEditorEl.classList.add('hidden');
  codePreviewEl.classList.add('hidden');
  sourceEditorEl.classList.add('hidden');
  frontmatterCard.classList.add('hidden');

  if (tab.fileKind === 'pdf') {
    pdfStageEl.classList.remove('hidden');
    pdfPreviewFrame.src = withCacheBust(tab.previewURL);
  } else if (tab.fileKind === 'image') {
    imageStageEl.classList.remove('hidden');
    imageZoomPct = null;
    applyImageZoom();
    imageStageMetaEl.textContent = tab.fileName;
    imageTabPreviewEl.src = withCacheBust(tab.previewURL);
    imageTabPreviewEl.alt = tab.fileName;
  } else if (tab.fileKind === 'html' && !tab.isSourceMode) {
    htmlStageEl.classList.remove('hidden');
    if (tab.isDirty) {
      htmlPreviewFrame.removeAttribute('src');
      htmlPreviewFrame.srcdoc = tab.sourceValue;
    } else {
      htmlPreviewFrame.removeAttribute('srcdoc');
      htmlPreviewFrame.src = withCacheBust(tab.previewURL);
    }
  } else if (tab.fileKind === 'html' || tab.fileKind === 'code' || tab.fileKind === 'text') {
    editorScrollEl.classList.remove('hidden');
    if (tab.isSourceMode) {
      sourceEditorEl.classList.remove('hidden');
      sourceEditorEl.value = tab.sourceValue;
      autoResizeSource();
    } else {
      codePreviewEl.classList.remove('hidden');
      renderCodeOrDataPreview(codePreviewEl, tab.sourceValue, tab.ext, (txt) => {
        postNative({ type: 'copyText', text: txt });
        showToast('내용 복사됨', 1500);
      });
    }
  } else {
    // Markdown tab
    editorScrollEl.classList.remove('hidden');
    if (tab.isSourceMode) {
      sourceEditorEl.classList.remove('hidden');
      sourceEditorEl.value = tab.sourceValue;
      autoResizeSource();
    } else {
      richEditorEl.classList.remove('hidden');
      if (tab.editorState) {
        suppressDirty = true;
        editor.view.updateState(tab.editorState);
        suppressDirty = false;
      } else {
        const { hasFm, fm, body } = splitFrontmatter(tab.content);
        tab.hasFrontmatter = hasFm;
        tab.frontmatterValue = fm;
        tab.editorState = createFreshEditorStateForBody(body);
      }
      renderFrontmatterUI(tab);
    }
  }

  syncToolbarForTab(tab);
  renderTabStrip();
  fileTree.syncWithActiveFile(tab.filePath);
  updateDocStats();
  updateOutline();
  inspector.refreshAll(false);
  if (findReplace.isOpen) {
    if (tab.fileKind === 'pdf' || tab.fileKind === 'image') {
      findReplace.close();
    } else {
      findReplace.refresh(false);
    }
  }

  if (!editorScrollEl.classList.contains('hidden')) {
    const prevBehavior = editorScrollEl.style.scrollBehavior;
    editorScrollEl.style.scrollBehavior = 'auto';
    requestAnimationFrame(() => {
      if (anchor && tab.fileKind === 'markdown') {
        if (!scrollToAnchor(anchor)) {
          editorScrollEl.scrollTop = savedScroll;
        }
      } else {
        editorScrollEl.scrollTop = savedScroll;
      }
      requestAnimationFrame(() => {
        editorScrollEl.style.scrollBehavior = prevBehavior;
        highlightActiveOutlineHeading();
      });
    });
  }
}

function activateTabLocal(tabId: string, anchor?: string, notifyNative = false) {
  const target = tabs.find((t) => t.id === tabId);
  if (!target) return;

  if (activeTabId === tabId) {
    if (anchor && target.fileKind === 'markdown') scrollToAnchor(anchor);
    return;
  }

  snapshotCurrentTab();
  pushTabHistory(tabId);
  mountTabToView(target, anchor);
  if (notifyNative) {
    postNative({ type: 'switchTab', tabId });
  }
}

function openTabFromNative(payload: OpenTabPayload) {
  const kind: FileKind = payload.fileKind || 'markdown';
  const ext = payload.ext || (kind === 'markdown' ? 'md' : '');
  const existing = tabs.find((t) => t.id === payload.tabId);
  if (existing) {
    existing.fileName = payload.fileName || '제목 없음.md';
    existing.filePath = payload.filePath || '';
    existing.fileKind = kind;
    existing.ext = ext;
    existing.previewURL = payload.previewURL || '';
    existing.fileSize = payload.fileSize || 0;
    existing.content = payload.content ?? '';
    existing.sourceValue = payload.content ?? '';
    existing.isSourceMode = false;
    existing.isDirty = false;
    existing.hasExternalConflict = false;
    existing.scrollTop = 0;
    existing.editorState = null;

    if (payload.activate !== false || activeTabId === existing.id) {
      pushTabHistory(existing.id);
      mountTabToView(existing, payload.anchor);
    } else {
      renderTabStrip();
    }
    return;
  }

  if (activeTabId && payload.activate !== false) {
    snapshotCurrentTab();
  }

  const newTab: TabDocState = {
    id: payload.tabId,
    fileName: payload.fileName || '제목 없음.md',
    filePath: payload.filePath || '',
    fileKind: kind,
    ext,
    previewURL: payload.previewURL || '',
    fileSize: payload.fileSize || 0,
    content: payload.content ?? '',
    hasFrontmatter: false,
    frontmatterValue: '',
    frontmatterOpen: false,
    isSourceMode: false,
    sourceValue: payload.content ?? '',
    scrollTop: 0,
    isDirty: false,
    hasExternalConflict: false,
    editorState: null,
  };
  tabs.push(newTab);

  if (payload.activate !== false || !activeTabId) {
    pushTabHistory(newTab.id);
    mountTabToView(newTab, payload.anchor);
  } else {
    renderTabStrip();
  }
}

function closeTabFromNative(payload: { tabId: string; nextActiveTabId?: string }) {
  const idx = tabs.findIndex((t) => t.id === payload.tabId);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  tabHistory = tabHistory.filter((id) => id !== payload.tabId);
  tabHistoryIndex = Math.min(tabHistoryIndex, tabHistory.length - 1);
  updateNavButtons();

  if (tabs.length === 0) {
    activeTabId = null;
    renderTabStrip();
    return;
  }

  if (activeTabId === payload.tabId) {
    const nextId = payload.nextActiveTabId ?? tabs[Math.min(idx, tabs.length - 1)].id;
    const nextTab = tabs.find((t) => t.id === nextId) ?? tabs[0];
    activeTabId = null;
    mountTabToView(nextTab);
  } else {
    renderTabStrip();
  }
}

function updateTabExternalContent(payload: UpdateExternalPayload) {
  const tab = tabs.find((t) => t.id === payload.tabId);
  if (!tab) return;

  tab.fileName = payload.fileName || tab.fileName;
  tab.filePath = payload.filePath || tab.filePath;
  if (payload.fileKind) tab.fileKind = payload.fileKind;
  if (payload.ext !== undefined) tab.ext = payload.ext;
  if (payload.previewURL !== undefined) tab.previewURL = payload.previewURL;
  if (payload.fileSize !== undefined) tab.fileSize = payload.fileSize;
  tab.content = payload.content;
  tab.sourceValue = payload.content;
  tab.isDirty = false;
  tab.hasExternalConflict = false;
  tab.editorState = null;

  if (tab.id === activeTabId) {
    mountTabToView(tab, undefined, true);
    showToast('외부 변경 반영됨', 2400);
  } else {
    renderTabStrip();
  }
}

// ── Paseo-Style Pill Tab Strip, Drag-Reorder & Context Menu ──

let draggedTabId: string | null = null;

function renderTabStrip() {
  tabStripEl.innerHTML = '';

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = tab.id === activeTabId ? `tab-item kind-${tab.fileKind} active` : `tab-item kind-${tab.fileKind}`;
    if (tab.isDirty) el.classList.add('dirty');
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.id === activeTabId));
    el.dataset.tabId = tab.id;
    el.draggable = true;
    el.title = tab.filePath || tab.fileName;

    const iconSpan = document.createElement('span');
    iconSpan.className = `tab-icon kind-${tab.fileKind}`;
    iconSpan.innerHTML = getFileIconSVG(tab.fileKind);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.fileName;

    const trailing = document.createElement('span');
    trailing.className = 'tab-trailing';

    const dotSpan = document.createElement('span');
    dotSpan.className = 'tab-dirty-dot';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tab-close-btn';
    closeBtn.title = '탭 닫기 (⌘W)';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      postNative({ type: 'closeTab', tabId: tab.id });
    });

    trailing.appendChild(dotSpan);
    trailing.appendChild(closeBtn);

    el.appendChild(iconSpan);
    el.appendChild(titleSpan);
    el.appendChild(trailing);

    el.addEventListener('click', () => {
      activateTabLocal(tab.id, undefined, true);
    });

    el.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        postNative({ type: 'closeTab', tabId: tab.id });
      }
    });

    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openTabContextMenu(tab.id, event.clientX, event.clientY);
    });

    el.addEventListener('dragstart', (event) => {
      draggedTabId = tab.id;
      el.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', tab.id);
    });

    el.addEventListener('dragend', () => {
      draggedTabId = null;
      el.classList.remove('dragging');
      tabStripEl.querySelectorAll('.tab-item').forEach((n) => {
        n.classList.remove('drag-over-before', 'drag-over-after');
      });
    });

    el.addEventListener('dragover', (event) => {
      if (!draggedTabId || draggedTabId === tab.id) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const isBefore = event.clientX < rect.left + rect.width / 2;
      el.classList.toggle('drag-over-before', isBefore);
      el.classList.toggle('drag-over-after', !isBefore);
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over-before', 'drag-over-after');
    });

    el.addEventListener('drop', (event) => {
      event.preventDefault();
      const isBefore = el.classList.contains('drag-over-before');
      el.classList.remove('drag-over-before', 'drag-over-after');
      if (!draggedTabId || draggedTabId === tab.id) return;
      const fromIdx = tabs.findIndex((t) => t.id === draggedTabId);
      let toIdx = tabs.findIndex((t) => t.id === tab.id);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = tabs.splice(fromIdx, 1);
      if (fromIdx < toIdx) toIdx -= 1;
      const insertIdx = isBefore ? toIdx : toIdx + 1;
      tabs.splice(insertIdx, 0, moved);
      renderTabStrip();
      postNative({ type: 'reorderTabs', orderedIds: tabs.map((t) => t.id) });
    });

    tabStripEl.appendChild(el);
  }

  const activeEl = tabStripEl.querySelector('.tab-item.active') as HTMLElement | null;
  activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function openTabContextMenu(tabId: string, x: number, y: number) {
  contextMenuTabId = tabId;
  const tab = tabs.find((t) => t.id === tabId);
  const detachBtn = tabContextMenuEl.querySelector('button[data-action="detach"]') as HTMLButtonElement;
  const openDefaultBtn = tabContextMenuEl.querySelector('button[data-action="openDefault"]') as HTMLButtonElement;
  const copyPathBtn = tabContextMenuEl.querySelector('button[data-action="copyPath"]') as HTMLButtonElement;
  const revealBtn = tabContextMenuEl.querySelector('button[data-action="reveal"]') as HTMLButtonElement;

  detachBtn.disabled = tabs.length <= 1 || !tab?.filePath;
  openDefaultBtn.disabled = !tab?.filePath;
  copyPathBtn.disabled = !tab?.filePath;
  revealBtn.disabled = !tab?.filePath;

  tabContextMenuEl.classList.remove('hidden');
  const rect = tabContextMenuEl.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - 8, x);
  const top = Math.min(window.innerHeight - rect.height - 8, y);
  tabContextMenuEl.style.left = `${Math.max(8, left)}px`;
  tabContextMenuEl.style.top = `${Math.max(8, top)}px`;
}

function hideTabContextMenu() {
  contextMenuTabId = null;
  tabContextMenuEl.classList.add('hidden');
}

tabContextMenuEl.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement | null)?.closest('button[data-action]') as HTMLButtonElement | null;
  if (!btn || btn.disabled || !contextMenuTabId) return;
  const tabId = contextMenuTabId;
  const tab = tabs.find((t) => t.id === tabId);
  hideTabContextMenu();

  switch (btn.dataset.action) {
    case 'close':
      postNative({ type: 'closeTab', tabId });
      break;
    case 'closeOthers':
      postNative({ type: 'closeOtherTabs', tabId });
      break;
    case 'closeRight':
      postNative({ type: 'closeRightTabs', tabId });
      break;
    case 'detach':
      postNative({ type: 'detachTab', tabId });
      break;
    case 'openDefault':
      postNative({ type: 'openWithDefaultApp', tabId });
      break;
    case 'copyPath':
      if (tab?.filePath) {
        postNative({ type: 'copyText', text: tab.filePath });
        showToast('파일 경로 복사됨', 1600);
      }
      break;
    case 'reveal':
      postNative({ type: 'revealInFinder', tabId });
      break;
  }
});

// ── Source Mode, Width Mode, Focus Mode, Font Size, Save, Rich Copy ──

function autoResizeSource() {
  sourceEditorEl.style.height = 'auto';
  sourceEditorEl.style.height = `${Math.max(sourceEditorEl.scrollHeight, window.innerHeight - 170)}px`;
}

function toggleSourceMode() {
  const tab = getActiveTab();
  if (!tab || !isEditableTextKind(tab.fileKind)) return;
  floatingTools.hideAll();

  if (tab.fileKind === 'html' || tab.fileKind === 'code' || tab.fileKind === 'text') {
    if (!tab.isSourceMode) {
      tab.isSourceMode = true;
      mountTabToView(tab, undefined, true);
      sourceEditorEl.focus();
    } else {
      tab.sourceValue = sourceEditorEl.value;
      tab.content = sourceEditorEl.value;
      tab.isSourceMode = false;
      mountTabToView(tab, undefined, true);
    }
    return;
  }

  // Markdown toggle
  if (!tab.isSourceMode) {
    const full = getMarkdownFromEditor(tab);
    tab.isSourceMode = true;
    tab.sourceValue = full;
    tab.content = full;
    sourceEditorEl.value = full;
    frontmatterCard.classList.add('hidden');
    richEditorEl.classList.add('hidden');
    sourceEditorEl.classList.remove('hidden');
    autoResizeSource();
    sourceEditorEl.focus();
  } else {
    const full = sourceEditorEl.value;
    const { hasFm, fm, body } = splitFrontmatter(full);
    tab.hasFrontmatter = hasFm;
    tab.frontmatterValue = fm;
    tab.sourceValue = full;
    tab.content = full;
    tab.isSourceMode = false;
    sourceEditorEl.classList.add('hidden');
    richEditorEl.classList.remove('hidden');
    renderFrontmatterUI(tab);
    tab.editorState = createFreshEditorStateForBody(body);
    updateOutline();
  inspector.refreshAll(false);
    editor.commands.focus();
  }

  syncToolbarForTab(tab);
  updateDocStats();
  if (findReplace.isOpen) findReplace.refresh(false);
}

const WIDTH_MODE_KEY = 'emdi:widthMode';
let isNarrowWidth = false;

function applyWidthMode(narrow: boolean, announce = false) {
  isNarrowWidth = narrow;
  documentContainerEl.classList.toggle('width-narrow', narrow);
  btnWidth.classList.toggle('active', narrow);
  btnWidth.title = narrow
    ? '읽기 집중 폭 (760px) — 클릭하여 반응형 넓게 전환'
    : '반응형 본문 폭 (최대 1080px) — 클릭하여 읽기 집중 폭(760px) 전환';
  try {
    window.localStorage.setItem(WIDTH_MODE_KEY, narrow ? 'narrow' : 'responsive');
  } catch {
    // Ignore
  }
  if (announce) {
    showToast(narrow ? '읽기 집중 폭 (760px)' : '반응형 본문 폭', 1600);
  }
}

function toggleWidthMode() {
  applyWidthMode(!isNarrowWidth, true);
}

function toggleFocusMode() {
  if (!focusModeActive) {
    preFocusSidebarOpen = fileTree.isOpen;
    preFocusNarrowWidth = isNarrowWidth;
    focusModeActive = true;
    fileTree.setSidebarOpen(false, false);
    applyWidthMode(true, false);
    showToast('집중 모드 켜짐 (⌘⇧F)', 1600);
  } else {
    focusModeActive = false;
    fileTree.setSidebarOpen(preFocusSidebarOpen, false);
    applyWidthMode(preFocusNarrowWidth, false);
    showToast('집중 모드 해제됨', 1600);
  }
}

try {
  applyWidthMode(window.localStorage.getItem(WIDTH_MODE_KEY) === 'narrow', false);
} catch {
  applyWidthMode(false, false);
}

function requestSave(targetTabId?: string) {
  const tab = targetTabId ? tabs.find((t) => t.id === targetTabId) : getActiveTab();
  if (!tab || !isEditableTextKind(tab.fileKind)) return;
  const content = getTabFullContent(tab);
  postNative({ type: 'save', tabId: tab.id, content, autoSave: false });
}

function applyFontSize(size: number) {
  currentFontSize = Math.min(24, Math.max(12, size));
  document.documentElement.style.setProperty('--doc-font-size', `${currentFontSize}px`);
}

function copyRichText() {
  const tab = getActiveTab();
  if (!tab) return;
  if (tab.fileKind !== 'markdown' || tab.isSourceMode) {
    const sel = sourceEditorEl.value.slice(sourceEditorEl.selectionStart, sourceEditorEl.selectionEnd);
    const text = sel || tab.sourceValue || '';
    if (text) {
      postNative({ type: 'copyText', text });
      showToast('텍스트 복사됨', 1600);
    }
    return;
  }

  const selection = window.getSelection();
  let html = '';
  let plain = '';
  if (selection && !selection.isCollapsed && richEditorEl.contains(selection.anchorNode)) {
    const container = document.createElement('div');
    for (let i = 0; i < selection.rangeCount; i++) {
      container.appendChild(selection.getRangeAt(i).cloneContents());
    }
    html = container.innerHTML;
    plain = selection.toString();
  } else {
    html = editor.getHTML();
    plain = editor.getText();
  }

  postNative({ type: 'copyRich', html, plain });
  showToast('서식 유지 복사됨', 1800);
}

// ── Editing Productivity Shortcuts (Checkbox, Highlight, Link, Move Line) ──

function toggleTaskCheckbox() {
  const tab = getActiveTab();
  if (!tab || tab.fileKind !== 'markdown') return;

  if (tab.isSourceMode) {
    const val = sourceEditorEl.value;
    const selStart = sourceEditorEl.selectionStart ?? 0;
    const selEnd = sourceEditorEl.selectionEnd ?? selStart;
    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    const nextNl = val.indexOf('\n', selEnd);
    const lineEnd = nextNl === -1 ? val.length : nextNl;
    const block = val.slice(lineStart, lineEnd);
    const updated = block
      .split('\n')
      .map((line) => {
        if (/^(\s*[-*+]\s+)\[ \]\s/.test(line)) {
          return line.replace(/^(\s*[-*+]\s+)\[ \]\s/, '$1[x] ');
        }
        if (/^(\s*[-*+]\s+)\[[xX]\]\s/.test(line)) {
          return line.replace(/^(\s*[-*+]\s+)\[[xX]\]\s/, '$1[ ] ');
        }
        if (/^(\s*[-*+]\s+)/.test(line)) {
          return line.replace(/^(\s*[-*+]\s+)/, '$1[ ] ');
        }
        return line.replace(/^(\s*)/, '$1- [ ] ');
      })
      .join('\n');
    sourceEditorEl.value = val.slice(0, lineStart) + updated + val.slice(lineEnd);
    sourceEditorEl.selectionStart = lineStart;
    sourceEditorEl.selectionEnd = lineStart + updated.length;
    autoResizeSource();
    markActiveDirty(true);
    updateDocStats();
    return;
  }

  const { state, view } = editor;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'taskItem') {
      const pos = $from.before(d);
      const checked = Boolean(node.attrs.checked);
      const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !checked });
      view.dispatch(tr);
      editor.commands.focus();
      return;
    }
  }

  editor.chain().focus().toggleTaskList().run();
}

function toggleHighlightAction() {
  const tab = getActiveTab();
  if (!tab || tab.fileKind !== 'markdown') return;

  if (tab.isSourceMode) {
    const val = sourceEditorEl.value;
    const start = sourceEditorEl.selectionStart ?? 0;
    const end = sourceEditorEl.selectionEnd ?? start;
    const sel = val.slice(start, end);
    let replacement: string;
    let nextStart: number;
    let nextEnd: number;
    if (sel.startsWith('==') && sel.endsWith('==') && sel.length >= 4) {
      replacement = sel.slice(2, -2);
      nextStart = start;
      nextEnd = start + replacement.length;
    } else {
      replacement = `==${sel}==`;
      nextStart = start + 2;
      nextEnd = nextStart + sel.length;
    }
    sourceEditorEl.value = val.slice(0, start) + replacement + val.slice(end);
    sourceEditorEl.selectionStart = nextStart;
    sourceEditorEl.selectionEnd = nextEnd;
    autoResizeSource();
    markActiveDirty(true);
    updateDocStats();
    return;
  }

  editor.chain().focus().toggleHighlight().run();
}

function openLinkEditorAction() {
  const tab = getActiveTab();
  if (!tab || tab.fileKind !== 'markdown') return;

  if (tab.isSourceMode) {
    const val = sourceEditorEl.value;
    const start = sourceEditorEl.selectionStart ?? 0;
    const end = sourceEditorEl.selectionEnd ?? start;
    const sel = val.slice(start, end) || '링크 텍스트';
    const snippet = `[${sel}](url)`;
    sourceEditorEl.value = val.slice(0, start) + snippet + val.slice(end);
    const urlStart = start + sel.length + 3;
    sourceEditorEl.focus();
    sourceEditorEl.selectionStart = urlStart;
    sourceEditorEl.selectionEnd = urlStart + 3;
    autoResizeSource();
    markActiveDirty(true);
    updateDocStats();
    return;
  }

  floatingTools.openLinkEditor();
}

function moveLineAction(delta: number) {
  const dir = delta < 0 ? -1 : 1;
  const tab = getActiveTab();
  if (!tab || !isEditableTextKind(tab.fileKind)) return;

  if (tab.isSourceMode || tab.fileKind !== 'markdown') {
    if (!tab.isSourceMode) return;
    const val = sourceEditorEl.value;
    const lines = val.split('\n');
    const selStart = sourceEditorEl.selectionStart ?? 0;
    const selEnd = sourceEditorEl.selectionEnd ?? selStart;

    const lineStarts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }

    const findLineIdx = (pos: number) => {
      let idx = 0;
      for (let i = 0; i < lineStarts.length; i++) {
        if (lineStarts[i] <= pos) idx = i;
        else break;
      }
      return idx;
    };

    const startLine = findLineIdx(selStart);
    const endLine = findLineIdx(Math.max(selStart, selEnd > selStart && val[selEnd - 1] === '\n' ? selEnd - 1 : selEnd));

    if (dir < 0 && startLine === 0) return;
    if (dir > 0 && endLine >= lines.length - 1) return;

    const block = lines.slice(startLine, endLine + 1);
    let deltaChars = 0;
    if (dir < 0) {
      const above = lines[startLine - 1];
      lines.splice(startLine - 1, block.length + 1, ...block, above);
      deltaChars = -(above.length + 1);
    } else {
      const below = lines[endLine + 1];
      lines.splice(startLine, block.length + 1, below, ...block);
      deltaChars = below.length + 1;
    }

    sourceEditorEl.value = lines.join('\n');
    sourceEditorEl.selectionStart = Math.max(0, selStart + deltaChars);
    sourceEditorEl.selectionEnd = Math.max(0, selEnd + deltaChars);
    markActiveDirty(true);
    return;
  }

  // Rich Markdown (ProseMirror): swap listItem/taskItem within its parent list, or top-level block
  const { state, view } = editor;
  const { $from } = state.selection;

  let targetDepth = 1;
  for (let d = $from.depth; d >= 2; d--) {
    const name = $from.node(d).type.name;
    if (name === 'taskItem' || name === 'listItem') {
      targetDepth = d;
      break;
    }
  }
  if ($from.depth < targetDepth) return;

  const parentDepth = targetDepth - 1;
  const parent = $from.node(parentDepth);
  const index = $from.index(parentDepth);
  const swapIndex = index + dir;
  if (swapIndex < 0 || swapIndex >= parent.childCount) return;

  const parentContentStart = parentDepth === 0 ? 0 : $from.start(parentDepth);
  const childPositions: number[] = [];
  let cursor = parentContentStart;
  for (let i = 0; i < parent.childCount; i++) {
    childPositions.push(cursor);
    cursor += parent.child(i).nodeSize;
  }

  const firstIdx = Math.min(index, swapIndex);
  const secondIdx = Math.max(index, swapIndex);
  const firstNode = parent.child(firstIdx);
  const secondNode = parent.child(secondIdx);
  const fromPos = childPositions[firstIdx];
  const toPos = childPositions[secondIdx] + secondNode.nodeSize;

  const offsetInTarget = state.selection.from - childPositions[index];
  const tr = state.tr.replaceWith(fromPos, toPos, [secondNode, firstNode]);
  const newTargetStart = dir < 0 ? fromPos : fromPos + secondNode.nodeSize;
  const targetCursorPos = Math.min(tr.doc.content.size, Math.max(1, newTargetStart + offsetInTarget));
  tr.setSelection(TextSelection.near(tr.doc.resolve(targetCursorPos)));
  view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

function isPeriodicNoteFileName(fileName: string): boolean {
  return /^(\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})\.md$/i.test(fileName.trim());
}

// ── Command Palette (Cmd+Shift+P) ──

const commandPalette = new CommandPaletteController({
  getCommands: (): CommandItem[] => [
    {
      id: 'periodic-daily',
      title: '오늘 일간 노트 열기',
      category: '주기',
      shortcut: '⌥1',
      keywords: ['daily', 'today', '일간', '데일리', '오늘'],
      run: () => postNative({ type: 'openPeriodicNote', kind: 'daily' }),
    },
    {
      id: 'periodic-weekly',
      title: '이번 주 주간 노트 열기',
      category: '주기',
      shortcut: '⌥2',
      keywords: ['weekly', 'week', '주간', '위클리', '이번주'],
      run: () => postNative({ type: 'openPeriodicNote', kind: 'weekly' }),
    },
    {
      id: 'periodic-monthly',
      title: '이번 달 월간 노트 열기',
      category: '주기',
      shortcut: '⌥3',
      keywords: ['monthly', 'month', '월간', '먼슬리', '이번달'],
      run: () => postNative({ type: 'openPeriodicNote', kind: 'monthly' }),
    },
    {
      id: 'periodic-yearly',
      title: '올해 연간 노트 열기',
      category: '주기',
      shortcut: '⌥4',
      keywords: ['yearly', 'year', '연간', '이어리', '올해'],
      run: () => postNative({ type: 'openPeriodicNote', kind: 'yearly' }),
    },
    {
      id: 'periodic-prev',
      title: '이전 주기 노트 (어제 / 지난주 / 지난달)',
      category: '주기',
      shortcut: '⌥←',
      keywords: ['prev', 'previous', 'yesterday', '이전', '어제', '지난주'],
      run: () => postNative({ type: 'navigatePeriodicNote', delta: -1 }),
    },
    {
      id: 'periodic-next',
      title: '다음 주기 노트 (내일 / 다음주 / 다음달)',
      category: '주기',
      shortcut: '⌥→',
      keywords: ['next', 'tomorrow', '다음', '내일', '다음주'],
      run: () => postNative({ type: 'navigatePeriodicNote', delta: 1 }),
    },
    {
      id: 'quick-open',
      title: '빠른 파일 열기',
      category: '이동',
      shortcut: '⌘K',
      keywords: ['quick', 'open', 'file', '검색', '파일', '열기'],
      run: () => fileTree.openQuickOpen(),
    },
    {
      id: 'toggle-outline',
      title: '문서 목차(Outline) 열기/닫기',
      category: '보기',
      shortcut: '⌘⇧O',
      keywords: ['outline', 'toc', '목차', '헤딩'],
      run: () => inspector.openTab('outline'),
    },
    {
      id: 'reveal-in-tree',
      title: '파일트리에서 현재 파일 위치 보기',
      category: '보기',
      shortcut: '⌘⇧L',
      keywords: ['reveal', 'tree', 'locate', '파일트리', '현재파일', '위치'],
      run: () => fileTree.revealActiveFile(),
    },
    {
      id: 'toggle-inspector',
      title: '우측 인스펙터 토글 (목차 · 할 일 · 연결)',
      category: '보기',
      shortcut: '⌘E',
      keywords: ['inspector', 'right', 'panel', 'tasks', 'backlinks', '인스펙터', '우측', '할일', '연결'],
      run: () => inspector.toggle(),
    },
    {
      id: 'toggle-sidebar',
      title: '사이드바 열기/닫기',
      category: '보기',
      shortcut: '⌘B',
      keywords: ['sidebar', '사이드바'],
      run: () => fileTree.toggleSidebar(),
    },
    {
      id: 'toggle-focus',
      title: '집중 모드 토글',
      category: '보기',
      shortcut: '⌘⇧F',
      keywords: ['focus', 'zen', '집중', '모드'],
      run: () => toggleFocusMode(),
    },
    {
      id: 'toggle-source',
      title: '원문 / 미리보기 전환',
      category: '보기',
      shortcut: '⌘/',
      keywords: ['source', 'preview', 'markdown', '원문', '미리보기'],
      run: () => toggleSourceMode(),
    },
    {
      id: 'toggle-width',
      title: '본문 폭 전환 (반응형 / 집중 760px)',
      category: '보기',
      keywords: ['width', 'narrow', 'wide', '폭', '너비'],
      run: () => toggleWidthMode(),
    },
    {
      id: 'toggle-task',
      title: '체크박스 토글 (- [ ] / - [x])',
      category: '편집',
      shortcut: '⌘↵',
      keywords: ['checkbox', 'task', 'todo', '체크', '할일'],
      run: () => toggleTaskCheckbox(),
    },
    {
      id: 'toggle-highlight',
      title: '하이라이트 토글 (==강조==)',
      category: '편집',
      shortcut: '⌘⇧H',
      keywords: ['highlight', 'mark', '하이라이트', '강조'],
      run: () => toggleHighlightAction(),
    },
    {
      id: 'open-link-editor',
      title: '링크 삽입 / 편집',
      category: '편집',
      shortcut: '⌘⇧K',
      keywords: ['link', 'url', '링크', '삽입'],
      run: () => openLinkEditorAction(),
    },
    {
      id: 'move-line-up',
      title: '현재 줄 / 항목 위로 이동',
      category: '편집',
      shortcut: '⌥↑',
      keywords: ['move', 'line', 'up', '줄이동', '위로'],
      run: () => moveLineAction(-1),
    },
    {
      id: 'move-line-down',
      title: '현재 줄 / 항목 아래로 이동',
      category: '편집',
      shortcut: '⌥↓',
      keywords: ['move', 'line', 'down', '줄이동', '아래로'],
      run: () => moveLineAction(1),
    },
    {
      id: 'copy-rel-path',
      title: '볼트 상대경로 복사',
      category: '복사',
      shortcut: '⌘⇧C',
      keywords: ['copy', 'relative', 'path', '상대경로', '경로복사'],
      run: () => postNative({ type: 'copyRelativePath', wikiLink: false }),
    },
    {
      id: 'copy-wikilink',
      title: '[[위키링크]] 복사',
      category: '복사',
      shortcut: '⌘⌥⇧C',
      keywords: ['copy', 'wikilink', 'wiki', '위키링크', '링크복사'],
      run: () => postNative({ type: 'copyRelativePath', wikiLink: true }),
    },
    {
      id: 'copy-rich',
      title: '서식 유지 복사 (HTML + 텍스트)',
      category: '복사',
      shortcut: '⌘⌥C',
      keywords: ['copy', 'rich', 'html', '서식', '복사'],
      run: () => copyRichText(),
    },
    {
      id: 'find',
      title: '문서 내 찾기',
      category: '편집',
      shortcut: '⌘F',
      keywords: ['find', 'search', '찾기'],
      run: () => findReplace.open(false),
    },
    {
      id: 'find-replace',
      title: '찾기 및 바꾸기',
      category: '편집',
      shortcut: '⌘⌥F',
      keywords: ['replace', 'find', '바꾸기'],
      run: () => findReplace.open(true),
    },
    {
      id: 'refresh-all',
      title: '현재 문서 및 파일트리 새로고침',
      category: '파일',
      shortcut: '⌘R',
      keywords: ['refresh', 'reload', '새로고침', '동기화'],
      run: () => postNative({ type: 'refreshAll' }),
    },
    {
      id: 'toggle-autosave',
      title: autoSaveEnabled ? '자동 저장 끄기' : '자동 저장 켜기',
      category: '파일',
      keywords: ['autosave', 'save', '자동저장'],
      run: () => {
        autoSaveEnabled = !autoSaveEnabled;
        btnAutoSave.classList.toggle('active', autoSaveEnabled);
        postNative({ type: 'toggleAutoSave', enabled: autoSaveEnabled });
        showToast(autoSaveEnabled ? '자동 저장 켜짐' : '자동 저장 꺼짐', 1600);
      },
    },
    {
      id: 'export-pdf',
      title: 'PDF로 내보내기',
      category: '파일',
      shortcut: '⌘⇧E',
      keywords: ['pdf', 'export', '내보내기'],
      run: () => postNative({ type: 'exportPDF' }),
    },
    {
      id: 'print-doc',
      title: '인쇄',
      category: '파일',
      shortcut: '⌘P',
      keywords: ['print', '인쇄'],
      run: () => postNative({ type: 'printDoc' }),
    },
    {
      id: 'reveal-finder',
      title: 'Finder에서 현재 파일 보기',
      category: '파일',
      shortcut: '⌘⇧R',
      keywords: ['finder', 'reveal', '파인더'],
      run: () => postNative({ type: 'revealInFinder', tabId: activeTabId ?? '' }),
    },
    {
      id: 'open-folder',
      title: '폴더 열기...',
      category: '파일',
      shortcut: '⌘⌥O',
      keywords: ['folder', 'vault', 'directory', 'open', '폴더', '볼트', '열기'],
      run: () => postNative({ type: 'openFolder' }),
    },
    {
      id: 'open-file',
      title: '파일 열기...',
      category: '파일',
      shortcut: '⌘O',
      keywords: ['file', 'open', '파일', '열기'],
      run: () => postNative({ type: 'openFile' }),
    },
    {
      id: 'open-default-app',
      title: '기본 앱으로 열기',
      category: '파일',
      keywords: ['default', 'open', 'app', '기본앱'],
      run: () => postNative({ type: 'openWithDefaultApp', tabId: activeTabId ?? '' }),
    },
    {
      id: 'close-other-tabs',
      title: '현재 탭 제외 다른 탭 모두 닫기',
      category: '탭',
      shortcut: '⌘⌥W',
      keywords: ['close', 'other', 'tabs', '다른탭', '닫기'],
      run: () => postNative({ type: 'closeOtherActiveTabs' }),
    },
    {
      id: 'reopen-closed-tab',
      title: '닫은 탭 다시 열기',
      category: '탭',
      shortcut: '⌘⇧T',
      keywords: ['reopen', 'closed', 'tab', '다시열기'],
      run: () => postNative({ type: 'reopenClosedTab' }),
    },
    {
      id: 'font-reset',
      title: '글자 크기 기본값으로 초기화',
      category: '보기',
      shortcut: '⌘0',
      keywords: ['font', 'zoom', 'reset', '글자', '크기'],
      run: () => applyFontSize(15.5),
    },
    ...(latestUpdateState?.hasUpdate
      ? [
          {
            id: 'install-update',
            title: `새 버전 v${latestUpdateState.latestVersion ?? ''} 지금 업데이트`,
            category: '앱',
            keywords: ['update', 'upgrade', 'release', '업데이트', '설치'],
            run: () => postNative({ type: 'installUpdate' }),
          },
        ]
      : []),
    {
      id: 'check-updates',
      title: '업데이트 확인 (GitHub Releases)',
      category: '앱',
      keywords: ['update', 'version', 'check', '업데이트', '버전', '확인'],
      run: () => postNative({ type: 'checkForUpdates' }),
    },
    {
      id: 'open-settings',
      title: '설정 및 색상 테마 변경',
      category: '앱',
      shortcut: '⌘,',
      keywords: ['settings', 'preferences', 'theme', 'color', 'palette', '설정', '테마', '색상'],
      run: () => settingsModal.open('appearance'),
    },
    {
      id: 'open-shortcuts',
      title: '키보드 단축키 안내 보기',
      category: '앱',
      keywords: ['shortcut', 'hotkey', 'keymap', 'help', '단축키', '키보드', '도움말'],
      run: () => settingsModal.open('shortcuts'),
    },
    {
      id: 'open-release-notes',
      title: '릴리즈 노트 및 변경 이력 보기',
      category: '앱',
      keywords: ['release', 'notes', 'changelog', 'version', '릴리즈', '변경이력'],
      run: () => settingsModal.open('releases'),
    },
    {
      id: 'open-feedback',
      title: '피드백 보내기 (버그 제보 · 기능 제안)',
      category: '앱',
      keywords: ['feedback', 'bug', 'issue', 'feature', 'email', '피드백', '버그', '제보', '제안', '문의', '이메일'],
      run: () => feedbackModal.open(),
    },
  ],
});

function getCurrentAppVersion(): string {
  const fromUpdate = latestUpdateState?.currentVersion?.trim();
  if (fromUpdate) return fromUpdate;
  const fromBtn = btnVersionCheck.textContent?.trim().replace(/^[vV]/, '') ?? '';
  return fromBtn || 'unknown';
}

function getCurrentOsInfo(): string {
  const fromNative = latestUpdateState?.osInfo?.trim();
  if (fromNative) return fromNative;
  return isMacPlatform ? 'macOS' : 'Windows';
}

const feedbackModal = new FeedbackModalController({
  getAppVersion: getCurrentAppVersion,
  getOsInfo: getCurrentOsInfo,
  onOpenExternal: (url) => postNative({ type: 'openExternal', url }),
  showToast,
});

const settingsModal = new SettingsModalController({
  getSettings: (): AppSettingsPayload => ({
    themeId: currentThemeId,
    accentId: currentAccentId,
    fontSize: currentFontSize,
    narrowWidth: isNarrowWidth,
    autoSave: autoSaveEnabled,
    defaultVaultPath,
  }),
  getUpdateState: () => latestUpdateState,
  onThemeChange: (themeId, accentId) => {
    applyThemeAndNotify(themeId, accentId, true);
  },
  onFontSizeChange: (size) => {
    applyFontSize(size);
    postNative({ type: 'saveSettings', fontSize: currentFontSize });
  },
  onWidthModeChange: (narrow) => {
    applyWidthMode(narrow, false);
    postNative({ type: 'saveSettings', narrowWidth: narrow });
  },
  onAutoSaveChange: (enabled) => {
    autoSaveEnabled = enabled;
    btnAutoSave.classList.toggle('active', autoSaveEnabled);
    postNative({ type: 'toggleAutoSave', enabled });
  },
  onPickVaultFolder: () => postNative({ type: 'pickDefaultVault' }),
  onClearVaultFolder: () => postNative({ type: 'clearDefaultVault' }),
  onCheckUpdates: () => postNative({ type: 'checkForUpdates' }),
  onInstallUpdate: () => postNative({ type: 'installUpdate' }),
  onOpenReleaseNotesExternal: () => {
    const url = latestUpdateState?.releaseURL || 'https://github.com/SheepCastle/emdi/releases';
    postNative({ type: 'openExternal', url });
  },
  onOpenFeedback: () => {
    feedbackModal.open();
  },
});

// ── In-App Update UI (Paseo Style) ──

function applyUpdateState(payload: UpdateStatePayload) {
  latestUpdateState = payload;

  if (payload.currentVersion) {
    btnVersionCheck.textContent = `v${payload.currentVersion}`;
    btnVersionCheck.title = `엠디 v${payload.currentVersion} — 클릭하여 업데이트 확인`;
  }

  const isBusy = payload.status === 'downloading' || payload.status === 'installing';
  const showAvailable = Boolean(payload.hasUpdate && payload.latestVersion);

  if (isBusy) {
    sidebarUpdateCardEl.classList.remove('hidden');
    sidebarUpdateCardEl.classList.add('busy');
    sucTitleEl.textContent = `v${payload.latestVersion ?? ''} 업데이트 중`;
    sucDescEl.textContent = payload.message || '새 버전을 적용하고 있습니다...';
    btnUpdateInstall.textContent = payload.status === 'downloading' ? '다운로드 중...' : '설치 중...';
    btnUpdateInstall.disabled = true;
    btnUpdateDismiss.classList.add('hidden');
    btnUpdatePill.classList.remove('hidden');
    btnUpdatePill.textContent = payload.status === 'downloading' ? '다운로드 중...' : '설치 중...';
    btnUpdatePill.disabled = true;
  } else if (showAvailable) {
    sidebarUpdateCardEl.classList.remove('busy');
    sidebarUpdateCardEl.classList.toggle('hidden', Boolean(payload.bannerDismissed));
    sucTitleEl.textContent = `v${payload.latestVersion} 업데이트 가능`;
    sucDescEl.textContent = `현재 v${payload.currentVersion} · 새 버전을 설치할 수 있습니다.`;
    btnUpdateInstall.textContent = '지금 업데이트';
    btnUpdateInstall.disabled = false;
    btnUpdateDismiss.classList.remove('hidden');
    btnUpdatePill.classList.remove('hidden');
    btnUpdatePill.textContent = `↑ v${payload.latestVersion} 업데이트`;
    btnUpdatePill.disabled = false;
  } else {
    sidebarUpdateCardEl.classList.add('hidden');
    sidebarUpdateCardEl.classList.remove('busy');
    btnUpdatePill.classList.add('hidden');
  }

  if (payload.toast) {
    showToast(payload.toast, 2800);
  }
  if (settingsModal.isVisible) {
    settingsModal.syncUI();
  }
}

// ── Lightbox ──

function openLightbox(src: string, caption: string) {
  lightboxImgEl.src = src;
  lightboxImgEl.alt = caption;
  lightboxCaptionEl.textContent = caption;
  lightboxCaptionEl.classList.toggle('hidden', !caption);
  lightboxEl.classList.remove('hidden');
}

function closeLightbox() {
  if (lightboxEl.classList.contains('hidden')) return;
  lightboxEl.classList.add('hidden');
  lightboxImgEl.src = '';
}

lightboxEl.addEventListener('click', () => closeLightbox());
lightboxCloseBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  closeLightbox();
});

// ── Link Hover Tooltip & Click / Cmd+Click Navigation ──

const EXTERNAL_URL_RE = /^https?:\/\/[^\s<>()]+$/i;
const EXTERNAL_HREF_RE = /^(https?:|mailto:)/i;

function resolveEventElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function getInlineCodeUrl(el: HTMLElement | null): { codeEl: HTMLElement; url: string } | null {
  if (!el) return null;
  const decorated = el.closest('[data-code-url]') as HTMLElement | null;
  if (decorated) {
    const url = (decorated.getAttribute('data-code-url') ?? '').trim();
    if (EXTERNAL_URL_RE.test(url)) {
      const codeEl = (decorated.closest('code') as HTMLElement | null) ?? decorated;
      return { codeEl, url };
    }
  }
  const codeEl = el.closest('code') as HTMLElement | null;
  if (!codeEl || codeEl.closest('pre')) return null;
  const text = (codeEl.textContent ?? '').trim();
  if (!EXTERNAL_URL_RE.test(text)) return null;
  return { codeEl, url: text };
}

type LinkAction =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; hash: string }
  | { kind: 'internal'; target: string; isWiki: boolean };

function resolveLinkAction(target: HTMLElement | null, modPressed: boolean): LinkAction | null {
  if (!target) return null;

  const wikiEl = target.closest('[data-wikilink="true"]') as HTMLElement | null;
  if (wikiEl) {
    if (!modPressed) return null;
    const rawTarget = (wikiEl.getAttribute('data-wiki-target') ?? '').trim();
    if (!rawTarget) return null;
    if (rawTarget.startsWith('#')) {
      return { kind: 'anchor', hash: rawTarget.slice(1) };
    }
    return { kind: 'internal', target: rawTarget, isWiki: true };
  }

  const anchor = target.closest('a') as HTMLAnchorElement | null;
  if (anchor) {
    const href = (anchor.getAttribute('href') ?? '').trim();
    if (!href) return null;
    const isExt = EXTERNAL_HREF_RE.test(href);
    if (!isExt && !modPressed) return null;
    if (href.startsWith('#')) {
      return { kind: 'anchor', hash: decodeURIComponent(href.slice(1)) };
    }
    if (isExt) {
      return { kind: 'external', url: href };
    }
    return { kind: 'internal', target: href, isWiki: false };
  }

  const codeUrl = getInlineCodeUrl(target);
  if (codeUrl) {
    return { kind: 'external', url: codeUrl.url };
  }

  return null;
}

function executeLinkAction(action: LinkAction) {
  hideLinkTooltip();
  if (action.kind === 'external') {
    postNative({ type: 'openExternal', url: action.url });
  } else if (action.kind === 'anchor') {
    scrollToAnchor(action.hash);
  } else {
    postNative({ type: 'openLink', target: action.target, isWiki: action.isWiki, tabId: activeTabId ?? '' });
  }
}

function hideLinkTooltip() {
  linkTooltipEl.classList.add('hidden');
}

function showLinkTooltip(text: string, anchorEl: HTMLElement, isExternal = false) {
  const modLabel = isMacPlatform ? '⌘+클릭' : 'Ctrl+클릭';
  linkTooltipEl.textContent = isExternal
    ? `클릭하여 브라우저로 열기 · ${text}`
    : `${modLabel}으로 열기 · ${text}`;
  linkTooltipEl.classList.remove('hidden');
  const rect = anchorEl.getBoundingClientRect();
  const tipRect = linkTooltipEl.getBoundingClientRect();
  const left = Math.max(10, Math.min(window.innerWidth - tipRect.width - 10, rect.left));
  const top = rect.bottom + 6 + tipRect.height > window.innerHeight ? rect.top - tipRect.height - 6 : rect.bottom + 6;
  linkTooltipEl.style.left = `${left}px`;
  linkTooltipEl.style.top = `${Math.max(8, top)}px`;
}

richEditorEl.addEventListener('mouseover', (event) => {
  const target = resolveEventElement(event.target);
  if (!target) return;

  const wikiEl = target.closest('[data-wikilink="true"]') as HTMLElement | null;
  if (wikiEl) {
    const dest = wikiEl.getAttribute('data-wiki-target') ?? '';
    if (dest) showLinkTooltip(dest, wikiEl, false);
    return;
  }

  const anchor = target.closest('a') as HTMLAnchorElement | null;
  if (anchor) {
    const href = (anchor.getAttribute('href') ?? '').trim();
    if (href) {
      const isExt = EXTERNAL_HREF_RE.test(href);
      showLinkTooltip(href, anchor, isExt);
    }
    return;
  }

  const codeUrl = getInlineCodeUrl(target);
  if (codeUrl) {
    showLinkTooltip(codeUrl.url, codeUrl.codeEl, true);
  }
});

richEditorEl.addEventListener('mouseout', (event) => {
  const target = resolveEventElement(event.target);
  const related = resolveEventElement(event.relatedTarget);
  if (
    target?.closest('[data-wikilink="true"], a, [data-code-url], code') &&
    !related?.closest('[data-wikilink="true"], a, [data-code-url], code')
  ) {
    hideLinkTooltip();
  }
});

interface PendingLinkGesture {
  action: LinkAction;
  startX: number;
  startY: number;
  modPressed: boolean;
}

let pendingLinkGesture: PendingLinkGesture | null = null;
let lastHandledLinkAt = 0;

richEditorEl.addEventListener(
  'mousedown',
  (event) => {
    pendingLinkGesture = null;
    if (event.button !== 0 || event.altKey) return;
    const target = resolveEventElement(event.target);
    if (!target || target.tagName === 'IMG') return;

    const modPressed = isMacPlatform ? event.metaKey : event.ctrlKey;
    const action = resolveLinkAction(target, modPressed);
    if (!action) return;

    pendingLinkGesture = {
      action,
      startX: event.clientX,
      startY: event.clientY,
      modPressed,
    };
  },
  true
);

window.addEventListener(
  'mouseup',
  (event) => {
    const gesture = pendingLinkGesture;
    pendingLinkGesture = null;
    if (!gesture || event.button !== 0 || event.altKey) return;
    if (event.detail > 1) return;

    const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (moved > 5) return;

    const hasSelection = !(window.getSelection()?.isCollapsed ?? true);
    if (hasSelection && !gesture.modPressed) return;

    lastHandledLinkAt = performance.now();
    executeLinkAction(gesture.action);
  },
  true
);

richEditorEl.addEventListener(
  'click',
  (event) => {
    const target = resolveEventElement(event.target);
    if (!target) return;

    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      if (img.src) {
        event.preventDefault();
        const caption = img.alt || img.getAttribute('data-raw-src') || '';
        openLightbox(img.src, caption);
      }
      return;
    }

    if (performance.now() - lastHandledLinkAt < 250) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.altKey) return;
    const modPressed = isMacPlatform ? event.metaKey : event.ctrlKey;
    const hasSelection = !(window.getSelection()?.isCollapsed ?? true);
    if (hasSelection && !modPressed) return;

    const action = resolveLinkAction(target, modPressed);
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      lastHandledLinkAt = performance.now();
      executeLinkAction(action);
    }
  },
  true
);

// ── UI Event Listeners ──

btnSidebarCollapse.addEventListener('click', () => fileTree.toggleSidebar());
btnSidebarOpen.addEventListener('click', () => fileTree.toggleSidebar());

btnNewTab.addEventListener('click', () => postNative({ type: 'newTab' }));
btnOpenDefault.addEventListener('click', () => postNative({ type: 'openWithDefaultApp', tabId: activeTabId ?? '' }));
btnQuickOpen.addEventListener('click', () => fileTree.openQuickOpen());
btnFind.addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab || tab.fileKind === 'pdf' || tab.fileKind === 'image') return;
  if (tab.fileKind !== 'markdown' && !tab.isSourceMode) {
    // Switch to source editor so Find & Replace works seamlessly on HTML/Code/Text
    tab.isSourceMode = true;
    mountTabToView(tab, undefined, true);
  }
  findReplace.open(false);
});
btnWidth.addEventListener('click', toggleWidthMode);
btnMode.addEventListener('click', toggleSourceMode);
btnSave.addEventListener('click', () => requestSave());

btnNavBack.addEventListener('click', () => navigateHistory(-1));
btnNavForward.addEventListener('click', () => navigateHistory(1));

btnAutoSave.addEventListener('click', () => {
  autoSaveEnabled = !autoSaveEnabled;
  btnAutoSave.classList.toggle('active', autoSaveEnabled);
  postNative({ type: 'toggleAutoSave', enabled: autoSaveEnabled });
  showToast(autoSaveEnabled ? '자동 저장 켜짐' : '자동 저장 꺼짐', 1600);
});

fileBreadcrumbEl.addEventListener('click', () => {
  const path = getActiveTab()?.filePath;
  if (!path) return;
  postNative({ type: 'copyText', text: path });
  showToast('파일 경로 복사됨', 1600);
});

frontmatterToggle.addEventListener('click', () => {
  const isOpen = frontmatterCard.classList.toggle('open');
  frontmatterBody.classList.toggle('hidden', !isOpen);
  const tab = getActiveTab();
  if (tab) tab.frontmatterOpen = isOpen;
});

frontmatterTextarea.addEventListener('input', () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.frontmatterValue = frontmatterTextarea.value;
  updateFrontmatterPreview(tab.frontmatterValue);
  markActiveDirty(true);
});

sourceEditorEl.addEventListener('input', () => {
  const tab = getActiveTab();
  if (tab) {
    tab.sourceValue = sourceEditorEl.value;
    tab.content = sourceEditorEl.value;
  }
  autoResizeSource();
  markActiveDirty(true);
  updateDocStats();
  if (findReplace.isOpen) findReplace.refresh(false);
});

sourceEditorEl.addEventListener('paste', (event) => {
  if (getActiveTab()?.fileKind !== 'markdown') return;
  const items = event.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        void uploadImageFile(file);
        return;
      }
    }
  }
});

let dragDepth = 0;
editorScrollEl.addEventListener('dragenter', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    dragDepth += 1;
    editorScrollEl.classList.add('drop-active');
  }
});

editorScrollEl.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault();
  }
});

editorScrollEl.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    editorScrollEl.classList.remove('drop-active');
  }
});

editorScrollEl.addEventListener('drop', (event) => {
  dragDepth = 0;
  editorScrollEl.classList.remove('drop-active');
  const tab = getActiveTab();
  if (!tab || tab.fileKind !== 'markdown' || !tab.isSourceMode) return;
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/') || IMAGE_EXT_RE.test(f.name));
  if (imageFiles.length === 0) return;
  event.preventDefault();
  for (const file of imageFiles) {
    void uploadImageFile(file);
  }
});

editorScrollEl.addEventListener('scroll', () => {
  highlightActiveOutlineHeading();
  hideLinkTooltip();
});

btnExternalReload.addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.hasExternalConflict = false;
  externalBannerEl.classList.add('hidden');
  postNative({ type: 'resolveExternalConflict', tabId: tab.id, action: 'reload' });
});

btnExternalKeep.addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.hasExternalConflict = false;
  externalBannerEl.classList.add('hidden');
  postNative({ type: 'resolveExternalConflict', tabId: tab.id, action: 'keep' });
  showToast('내 편집 유지됨', 1800);
});

btnUpdateInstall.addEventListener('click', () => {
  postNative({ type: 'installUpdate' });
});

btnUpdateNotes.addEventListener('click', () => {
  settingsModal.open('releases');
});

btnUpdateDismiss.addEventListener('click', () => {
  sidebarUpdateCardEl.classList.add('hidden');
  postNative({ type: 'dismissUpdateBanner' });
});

btnSidebarSettings.addEventListener('click', () => {
  settingsModal.open('appearance');
});

btnSidebarShortcuts.addEventListener('click', () => {
  settingsModal.open('shortcuts');
});

btnSidebarFeedback.addEventListener('click', () => {
  feedbackModal.open();
});

btnUpdatePill.addEventListener('click', () => {
  postNative({ type: 'installUpdate' });
});

btnVersionCheck.addEventListener('click', () => {
  postNative({ type: 'checkForUpdates' });
});

sidebarHeaderEl.addEventListener('mousedown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('button, input')) return;
  if (event.button === 0) {
    postNative({ type: 'startDrag' });
  }
});

tabbarEl.addEventListener('mousedown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('.tab-item, button, input')) return;
  if (event.button === 0) {
    postNative({ type: 'startDrag' });
  }
});

tabbarDragSpacer.addEventListener('dblclick', () => {
  postNative({ type: 'newTab' });
});

window.addEventListener('click', (event) => {
  if (!tabContextMenuEl.classList.contains('hidden')) {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('#tab-context-menu')) {
      hideTabContextMenu();
    }
  }
});

// ── Keyboard Shortcuts (Paseo Aligned) ──

window.addEventListener(
  'keydown',
  (event) => {
    if (
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const targetEl = event.target as HTMLElement | null;
      const inFormInput = targetEl?.tagName === 'INPUT' || targetEl?.tagName === 'TEXTAREA';
      const activeTab = getActiveTab();
      if (!inFormInput && activeTab && isPeriodicNoteFileName(activeTab.fileName)) {
        event.preventDefault();
        event.stopPropagation();
        postNative({ type: 'navigatePeriodicNote', delta: event.key === 'ArrowLeft' ? -1 : 1 });
      }
    }
  },
  true
);

window.addEventListener('keydown', (event) => {
  if ((isMacPlatform && event.key === 'Meta') || (!isMacPlatform && event.key === 'Control')) {
    document.body.classList.add('meta-pressed');
  }

  if (event.key === 'Escape') {
    if (feedbackModal.isVisible) {
      event.preventDefault();
      feedbackModal.close();
      return;
    }
    if (settingsModal.isVisible) {
      event.preventDefault();
      settingsModal.close();
      return;
    }
    if (commandPalette.isVisible) {
      event.preventDefault();
      commandPalette.close();
      return;
    }
    if (fileTree.isQuickOpenVisible) {
      event.preventDefault();
      fileTree.closeQuickOpen();
      return;
    }
    if (!lightboxEl.classList.contains('hidden')) {
      event.preventDefault();
      closeLightbox();
      return;
    }
    if (!tabContextMenuEl.classList.contains('hidden')) {
      event.preventDefault();
      hideTabContextMenu();
      return;
    }
    if (findReplace.isOpen) {
      event.preventDefault();
      findReplace.close();
      return;
    }
  }

  if (event.ctrlKey && !event.metaKey && event.key === 'Tab') {
    event.preventDefault();
    if (tabs.length > 1 && activeTabId) {
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const delta = event.shiftKey ? -1 : 1;
      const nextIdx = (idx + delta + tabs.length) % tabs.length;
      activateTabLocal(tabs[nextIdx].id, undefined, true);
    }
    return;
  }

  if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    const periodicMap: Record<string, string> = {
      Digit1: 'daily',
      Digit2: 'weekly',
      Digit3: 'monthly',
      Digit4: 'yearly',
    };
    const periodicKind = periodicMap[event.code];
    if (periodicKind) {
      event.preventDefault();
      postNative({ type: 'openPeriodicNote', kind: periodicKind });
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const targetEl = event.target as HTMLElement | null;
      if (targetEl?.tagName !== 'INPUT') {
        event.preventDefault();
        moveLineAction(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
    }
  }

  const isMod = isMacPlatform ? (event.metaKey && !event.ctrlKey) : (event.ctrlKey && !event.metaKey);
  if (!isMod) return;

  if (!isMacPlatform) {
    const winKey = event.key.toLowerCase();
    if (winKey === 'o' && event.altKey && !event.shiftKey) {
      event.preventDefault();
      postNative({ type: 'openFolder' });
      return;
    }
    if (winKey === 'o' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      postNative({ type: 'openFile' });
      return;
    }
    if (winKey === 't' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      postNative({ type: 'newTab' });
      return;
    }
    if (winKey === 't' && event.shiftKey && !event.altKey) {
      event.preventDefault();
      postNative({ type: 'reopenClosedTab' });
      return;
    }
    if (winKey === 'w' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (activeTabId) postNative({ type: 'closeTab', tabId: activeTabId });
      return;
    }
    if (winKey === 'r' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      postNative({ type: 'refreshAll' });
      return;
    }
    if (winKey === ',' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      settingsModal.open('appearance');
      return;
    }
    if (winKey === 'p' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      window.print();
      return;
    }
  }

  if (event.altKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    postNative({ type: 'navigatePeriodicNote', delta: event.key === 'ArrowLeft' ? -1 : 1 });
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
    const targetEl = event.target as HTMLElement | null;
    if (targetEl?.tagName !== 'INPUT') {
      event.preventDefault();
      toggleTaskCheckbox();
      return;
    }
  }

  const key = event.key.toLowerCase();

  if (key === ',' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    fileTree.closeQuickOpen();
    commandPalette.close();
    settingsModal.open('appearance');
    return;
  }

  if (key === 'p' && event.shiftKey && !event.altKey) {
    event.preventDefault();
    fileTree.closeQuickOpen();
    commandPalette.open();
    return;
  }

  if (key === 'o' && event.shiftKey && !event.altKey) {
    event.preventDefault();
    inspector.openTab('outline');
    return;
  }

  if (key === 'l' && event.shiftKey && !event.altKey) {
    event.preventDefault();
    fileTree.revealActiveFile();
    return;
  }

  if (key === 'h' && event.shiftKey && !event.altKey) {
    event.preventDefault();
    toggleHighlightAction();
    return;
  }

  if (key === 'k' && event.shiftKey && !event.altKey) {
    event.preventDefault();
    openLinkEditorAction();
    return;
  }

  if (key === 'c' && event.shiftKey) {
    event.preventDefault();
    postNative({ type: 'copyRelativePath', wikiLink: event.altKey });
    return;
  }

  if (key === 'r' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    postNative({ type: 'refreshAll' });
    return;
  }

  if (key === 'b' && !event.altKey) {
    event.preventDefault();
    if (event.shiftKey) {
      const tab = getActiveTab();
      if (tab?.fileKind === 'markdown' && !tab.isSourceMode) {
        editor.chain().focus().toggleBold().run();
      }
    } else {
      fileTree.toggleSidebar();
    }
    return;
  }

  if (key === 'e' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    inspector.toggle();
    return;
  }

  if (key === '\\' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    fileTree.toggleSidebar();
    return;
  }

  if (key === 'k' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    fileTree.openQuickOpen();
    return;
  }

  if (key === 'f' && event.shiftKey && !event.altKey) {
    event.preventDefault();
    toggleFocusMode();
    return;
  }

  if (key === 'f' && !event.shiftKey) {
    const tab = getActiveTab();
    if (tab && (tab.fileKind === 'pdf' || tab.fileKind === 'image')) return;
    event.preventDefault();
    if (tab && tab.fileKind !== 'markdown' && !tab.isSourceMode) {
      tab.isSourceMode = true;
      mountTabToView(tab, undefined, true);
    }
    findReplace.open(event.altKey);
    return;
  }

  if (/^[1-9]$/.test(event.key) && !event.shiftKey) {
    const idx = Number(event.key) - 1;
    if (tabs[idx]) {
      event.preventDefault();
      activateTabLocal(tabs[idx].id, undefined, true);
    }
    return;
  }

  if (key === 's' && !event.shiftKey) {
    event.preventDefault();
    requestSave();
  } else if (key === '/') {
    event.preventDefault();
    toggleSourceMode();
  } else if (key === '=' || key === '+') {
    event.preventDefault();
    applyFontSize(currentFontSize + 1);
  } else if (key === '-') {
    event.preventDefault();
    applyFontSize(currentFontSize - 1);
  } else if (key === '0') {
    event.preventDefault();
    applyFontSize(15.5);
  } else if (key === '[' && !event.shiftKey) {
    event.preventDefault();
    navigateHistory(-1);
  } else if (key === ']' && !event.shiftKey) {
    event.preventDefault();
    navigateHistory(1);
  }
});

window.addEventListener('keyup', (event) => {
  if ((isMacPlatform && event.key === 'Meta') || (!isMacPlatform && event.key === 'Control')) {
    document.body.classList.remove('meta-pressed');
  }
});

window.addEventListener('blur', () => {
  document.body.classList.remove('meta-pressed');
  hideLinkTooltip();
});

// ── Expose Native Bridge API ──

window.__emdi = {
  openTab: openTabFromNative,
  openFolder: ({ path }) => {
    if (!path) return;
    fileTree.setMode('folder');
    fileTree.setSidebarOpen(true);
    fileTree.setRoot(path);
  },
  activateTab: ({ tabId, anchor }) => activateTabLocal(tabId, anchor, false),
  closeTab: closeTabFromNative,
  updateTabExternalContent,
  requestSave: (payload) => requestSave(payload?.tabId),
  toggleSourceMode,
  toggleSidebar: () => fileTree.toggleSidebar(),
  toggleFileTree: () => fileTree.toggleSidebar(),
  toggleInspector: () => inspector.toggle(),
  toggleOutline: () => inspector.openTab('outline'),
  revealActiveInTree: () => fileTree.revealActiveFile(),
  toggleFocusMode,
  openQuickOpen: () => {
    commandPalette.close();
    feedbackModal.close();
    fileTree.openQuickOpen();
  },
  openCommandPalette: () => {
    fileTree.closeQuickOpen();
    settingsModal.close();
    feedbackModal.close();
    commandPalette.open();
  },
  openSettings: (payload) => {
    fileTree.closeQuickOpen();
    commandPalette.close();
    feedbackModal.close();
    settingsModal.open(payload?.tab ?? 'appearance');
  },
  openFeedback: () => {
    fileTree.closeQuickOpen();
    commandPalette.close();
    settingsModal.close();
    feedbackModal.open();
  },
  applySettings: (payload) => {
    if (payload.themeId || payload.accentId) {
      applyThemeAndNotify(payload.themeId ?? currentThemeId, payload.accentId ?? currentAccentId, false);
    }
    if (typeof payload.fontSize === 'number') {
      applyFontSize(payload.fontSize);
    }
    if (typeof payload.narrowWidth === 'boolean') {
      applyWidthMode(payload.narrowWidth, false);
    }
    if (typeof payload.autoSave === 'boolean') {
      autoSaveEnabled = payload.autoSave;
      btnAutoSave.classList.toggle('active', autoSaveEnabled);
    }
    if (typeof payload.defaultVaultPath === 'string') {
      defaultVaultPath = payload.defaultVaultPath;
    }
    if (settingsModal.isVisible) {
      settingsModal.syncUI();
    }
  },
  setChangelog: ({ markdown }) => {
    settingsModal.setChangelog(markdown || '');
  },
  toggleWidthMode,
  openFind: (payload) => {
    const tab = getActiveTab();
    if (!tab || tab.fileKind === 'pdf' || tab.fileKind === 'image') return;
    if (tab.fileKind !== 'markdown' && !tab.isSourceMode) {
      tab.isSourceMode = true;
      mountTabToView(tab, undefined, true);
    }
    findReplace.open(Boolean(payload?.replace));
  },
  navigateHistory: (payload) => navigateHistory(payload?.delta ?? 0),
  copyRichText,
  toggleTaskCheckbox,
  toggleHighlight: toggleHighlightAction,
  openLinkEditor: openLinkEditorAction,
  moveLine: (payload) => moveLineAction(payload?.delta ?? 0),
  refreshFileTree: (silent = false) => fileTree.refreshTree(Boolean(silent)),
  adjustFontSize: (delta: number) => applyFontSize(currentFontSize + delta),
  resetFontSize: () => applyFontSize(15.5),
  markSaved: ({ tabId, fileName, filePath, previewURL, silent }) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      if (fileName) tab.fileName = fileName;
      if (filePath) tab.filePath = filePath;
      if (previewURL) tab.previewURL = previewURL;
      tab.isDirty = false;
      tab.hasExternalConflict = false;
      if (tab.id === activeTabId) {
        document.title = tab.fileName;
        fileBreadcrumbEl.textContent = formatBreadcrumb(tab.filePath, tab.fileName);
        fileBreadcrumbEl.title = tab.filePath ? `${tab.filePath} (클릭하여 경로 복사)` : tab.fileName;
        externalBannerEl.classList.add('hidden');
        if (filePath) fileTree.syncWithActiveFile(filePath);
      }
      renderTabStrip();
    }
    if (!silent) {
      showToast('저장됨', 1600);
    }
  },
  setFullScreen: ({ fullScreen }) => {
    appEl.classList.toggle('fullscreen', Boolean(fullScreen));
  },
  setAutoSave: ({ enabled }) => {
    autoSaveEnabled = Boolean(enabled);
    btnAutoSave.classList.toggle('active', autoSaveEnabled);
  },
  setPrintMode: ({ enabled }) => {
    document.body.classList.toggle('print-mode', Boolean(enabled));
    if (enabled) {
      floatingTools.hideAll();
      hideLinkTooltip();
      fileTree.closeQuickOpen();
      commandPalette.close();
      settingsModal.close();
      feedbackModal.close();
    }
  },
  onTreeChildrenLoaded: (payload) => fileTree.onChildrenLoaded(payload),
  onTreeSearchResults: (payload) => fileTree.onSearchResults(payload),
  onBacklinksLoaded: (payload) => inspector.onBacklinksLoaded(payload),
  onDataviewResult: (payload) => handleDataviewResult(payload),
  notifyExternalConflict: ({ tabId }) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.hasExternalConflict = true;
    if (tab.id === activeTabId) {
      externalBannerEl.classList.remove('hidden');
    }
  },
  onImageSaved: ({ relativePath, alt }) => {
    if (relativePath) {
      insertImageAtCursor(relativePath, alt ?? '');
    }
  },
  onImageSaveError: ({ message, silent }) => {
    if (silent) return;
    showToast(message || '이미지 저장 실패', 3000);
  },
  onUpdateState: applyUpdateState,
  showToast: ({ message }) => {
    if (message) showToast(message, 2600);
  },
};

postNative({ type: 'ready' });
