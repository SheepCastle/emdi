import type { FileKind, TreeChildrenPayload, TreeNodeItem, TreeSearchPayload } from '../types';
import { CHEVRON_SVG, getFileIconSVG } from './file-icons';

export interface FileTreeOptions {
  postNative: (payload: Record<string, unknown>) => void;
  getActiveFilePath: () => string;
  getOpenTabFiles: () => { fileName: string; filePath: string; fileKind: FileKind; ext: string }[];
  showToast: (msg: string) => void;
}

const SIDEBAR_WIDTH_KEY = 'emdi:sidebarWidth';
const SIDEBAR_OPEN_KEY = 'emdi:sidebarOpen';
const TREE_MD_ONLY_KEY = 'emdi:treeOnlyMarkdown';

function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx > 0 ? filePath.slice(0, idx) : '/';
}

function isDescendantPath(childPath: string, rootPath: string): boolean {
  if (!childPath || !rootPath) return false;
  if (childPath === rootPath) return true;
  const prefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
  return childPath.startsWith(prefix);
}

export class FileTreeController {
  private readonly opts: FileTreeOptions;

  private readonly appEl = document.getElementById('app') as HTMLDivElement;
  private readonly sidebarEl = document.getElementById('sidebar-panel') as HTMLElement;
  private readonly resizerEl = document.getElementById('sidebar-resizer') as HTMLDivElement;
  private readonly tabFolderBtn = document.getElementById('sidebar-tab-folder') as HTMLButtonElement;
  private readonly tabOutlineBtn = document.getElementById('sidebar-tab-outline') as HTMLButtonElement;
  private readonly folderViewEl = document.getElementById('folder-view') as HTMLElement;
  private readonly outlineViewEl = document.getElementById('outline-view') as HTMLElement;
  private readonly rootNameEl = document.getElementById('tree-root-name') as HTMLSpanElement;
  private readonly btnMdOnly = document.getElementById('btn-tree-md-only') as HTMLButtonElement;
  private readonly btnUp = document.getElementById('btn-tree-up') as HTMLButtonElement;
  private readonly btnVault = document.getElementById('btn-tree-vault') as HTMLButtonElement;
  private readonly btnRevealActive = document.getElementById('btn-tree-reveal-active') as HTMLButtonElement;
  private readonly btnRefresh = document.getElementById('btn-tree-refresh') as HTMLButtonElement;
  private readonly filterInput = document.getElementById('tree-filter-input') as HTMLInputElement;
  private readonly filterClearBtn = document.getElementById('btn-tree-filter-clear') as HTMLButtonElement;
  private readonly listEl = document.getElementById('file-tree-list') as HTMLDivElement;
  private readonly contextMenuEl = document.getElementById('tree-context-menu') as HTMLDivElement;

  private readonly quickBackdrop = document.getElementById('quick-open-backdrop') as HTMLDivElement;
  private readonly quickInput = document.getElementById('quick-open-input') as HTMLInputElement;
  private readonly quickList = document.getElementById('quick-open-list') as HTMLDivElement;

  private sidebarOpen = true;
  private sidebarMode: 'folder' | 'outline' = 'folder';
  private onlyMarkdown = false;
  private rootPath = '';
  private rootName = '';
  private parentPath = '';
  private vaultRootPath = '';
  private expandedPaths = new Set<string>();
  private childrenCache = new Map<string, TreeNodeItem[]>();
  private loadingPaths = new Set<string>();
  private filterQuery = '';
  private filterResults: TreeNodeItem[] = [];
  private filterTimer: number | undefined;
  private contextTarget: TreeNodeItem | null = null;
  private requestSeq = 0;

  private quickResults: TreeNodeItem[] = [];
  private quickIndex = 0;
  private quickTimer: number | undefined;

  constructor(opts: FileTreeOptions) {
    this.opts = opts;
    this.restoreSidebarPrefs();
    this.bindEvents();
    this.bindResizer();
    this.bindQuickOpenEvents();
  }

  get isOpen(): boolean {
    return this.sidebarOpen;
  }

  get isQuickOpenVisible(): boolean {
    return !this.quickBackdrop.classList.contains('hidden');
  }

  private restoreSidebarPrefs() {
    try {
      const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (savedWidth >= 180 && savedWidth <= 460) {
        this.sidebarEl.style.width = `${savedWidth}px`;
      }
      const savedOpen = window.localStorage.getItem(SIDEBAR_OPEN_KEY);
      this.setSidebarOpen(savedOpen !== 'false', false);
      this.onlyMarkdown = window.localStorage.getItem(TREE_MD_ONLY_KEY) === 'true';
      this.updateMdOnlyButton();
    } catch {
      this.setSidebarOpen(true, false);
    }
  }

  private updateMdOnlyButton() {
    this.btnMdOnly.textContent = this.onlyMarkdown ? 'MD' : '전체';
    this.btnMdOnly.classList.toggle('active', this.onlyMarkdown);
  }

  setSidebarOpen(open: boolean, persist = true) {
    this.sidebarOpen = open;
    this.sidebarEl.classList.toggle('collapsed', !open);
    this.resizerEl.classList.toggle('hidden', !open);
    this.appEl.classList.toggle('sidebar-collapsed', !open);
    if (persist) {
      try {
        window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(open));
      } catch {
        // Ignore
      }
    }
  }

  toggleSidebar() {
    this.setSidebarOpen(!this.sidebarOpen);
  }

  toggleFileTreeMode() {
    if (this.sidebarOpen && this.sidebarMode === 'folder') {
      this.setSidebarOpen(false);
    } else {
      this.setMode('folder');
      this.setSidebarOpen(true);
    }
  }

  toggleOutlineMode(onOutlineActivate?: () => void) {
    if (this.sidebarOpen && this.sidebarMode === 'outline') {
      this.setSidebarOpen(false);
    } else {
      this.setMode('outline', onOutlineActivate);
      this.setSidebarOpen(true);
    }
  }

  revealActiveFile() {
    const active = this.opts.getActiveFilePath();
    if (!active) {
      this.opts.showToast('열려 있는 저장된 파일이 없습니다');
      return;
    }
    this.setMode('folder');
    this.setSidebarOpen(true);
    if (this.filterQuery.trim()) {
      this.filterInput.value = '';
      this.filterQuery = '';
      this.filterResults = [];
      this.filterClearBtn.classList.add('hidden');
    }
    if (this.rootPath && isDescendantPath(active, this.rootPath)) {
      this.expandAncestorsAndReveal(active);
    } else if (this.vaultRootPath && isDescendantPath(active, this.vaultRootPath)) {
      this.setRoot(this.vaultRootPath, active);
    } else {
      this.setRoot(dirOf(active), active);
    }
  }

  setMode(mode: 'folder' | 'outline', onOutlineActivate?: () => void) {
    this.sidebarMode = mode;
    this.tabFolderBtn.classList.toggle('active', mode === 'folder');
    this.tabOutlineBtn.classList.toggle('active', mode === 'outline');
    this.folderViewEl.classList.toggle('hidden', mode !== 'folder');
    this.outlineViewEl.classList.toggle('hidden', mode !== 'outline');
    if (mode === 'outline') {
      onOutlineActivate?.();
    } else {
      this.renderTree();
    }
  }

  // ── Stable Root & Active File Sync ──

  syncWithActiveFile(filePath: string) {
    if (!filePath) {
      this.renderTree();
      return;
    }

    const fileDir = dirOf(filePath);

    if (this.rootPath && isDescendantPath(filePath, this.rootPath)) {
      this.expandAncestorsAndReveal(filePath);
      return;
    }

    if (this.vaultRootPath && isDescendantPath(filePath, this.vaultRootPath)) {
      this.setRoot(this.vaultRootPath, filePath);
      return;
    }

    this.setRoot(fileDir, filePath);
  }

  setRoot(newRootPath: string, revealFilePath?: string) {
    if (!newRootPath) return;
    this.rootPath = newRootPath;
    this.rootName = newRootPath.split('/').filter(Boolean).pop() || '/';
    this.expandedPaths.add(newRootPath);
    this.requestChildren(newRootPath);
    if (revealFilePath && isDescendantPath(revealFilePath, newRootPath)) {
      this.expandAncestorsAndReveal(revealFilePath);
    }
    this.renderHeader();
    this.renderTree();
  }

  private expandAncestorsAndReveal(filePath: string) {
    if (!this.rootPath || !isDescendantPath(filePath, this.rootPath)) return;
    let cursor = dirOf(filePath);
    const toLoad: string[] = [];
    while (cursor && isDescendantPath(cursor, this.rootPath)) {
      this.expandedPaths.add(cursor);
      if (!this.childrenCache.has(cursor)) {
        toLoad.push(cursor);
      }
      if (cursor === this.rootPath) break;
      const parent = dirOf(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    for (const dir of toLoad.reverse()) {
      this.requestChildren(dir);
    }
    this.renderTree();
    requestAnimationFrame(() => {
      const activeEl = this.listEl.querySelector('.tree-row.active') as HTMLElement | null;
      activeEl?.scrollIntoView({ block: 'nearest' });
    });
  }

  private requestChildren(dirPath: string) {
    if (!dirPath || this.loadingPaths.has(dirPath)) return;
    this.loadingPaths.add(dirPath);
    const requestId = `tree-${++this.requestSeq}`;
    this.opts.postNative({
      type: 'listTreeChildren',
      path: dirPath,
      onlyMarkdown: this.onlyMarkdown,
      requestId,
    });
  }

  onChildrenLoaded(payload: TreeChildrenPayload) {
    this.loadingPaths.delete(payload.dirPath);
    this.childrenCache.set(payload.dirPath, payload.items);

    if (payload.vaultRootPath) {
      this.vaultRootPath = payload.vaultRootPath;
    }
    if (payload.dirPath === this.rootPath) {
      this.rootName = payload.dirName || this.rootName;
      this.parentPath = payload.parentPath || '';
      this.renderHeader();
    }
    this.renderTree();
  }

  onSearchResults(payload: TreeSearchPayload) {
    if (payload.target === 'quickOpen') {
      if (payload.query.trim() !== this.quickInput.value.trim()) return;
      this.quickResults = payload.items;
      this.quickIndex = 0;
      this.renderQuickOpenList();
      return;
    }
    if (payload.query.trim() !== this.filterQuery.trim()) return;
    this.filterResults = payload.items;
    this.renderTree();
  }

  refreshTree(silent = false) {
    if (!this.rootPath) return;
    this.childrenCache.clear();
    this.loadingPaths.clear();
    this.requestChildren(this.rootPath);
    for (const dir of this.expandedPaths) {
      if (dir !== this.rootPath && isDescendantPath(dir, this.rootPath)) {
        this.requestChildren(dir);
      }
    }
    if (this.filterQuery.trim()) {
      this.triggerTreeFilterSearch();
    }
    if (!silent) {
      this.opts.showToast('파일트리 새로고침됨');
    }
  }

  private triggerTreeFilterSearch() {
    if (!this.rootPath || !this.filterQuery.trim()) return;
    const requestId = `flt-${++this.requestSeq}`;
    this.opts.postNative({
      type: 'searchTreeFiles',
      rootPath: this.rootPath,
      query: this.filterQuery,
      onlyMarkdown: this.onlyMarkdown,
      target: 'tree',
      requestId,
    });
  }

  // ── Rendering ──

  private renderHeader() {
    this.rootNameEl.textContent = this.rootName || '열린 폴더 없음';
    this.rootNameEl.title = this.rootPath || '';
    this.btnUp.disabled = !this.parentPath;
    const showVaultBtn = Boolean(this.vaultRootPath && this.vaultRootPath !== this.rootPath);
    this.btnVault.classList.toggle('hidden', !showVaultBtn);
    if (showVaultBtn) {
      const vaultName = this.vaultRootPath.split('/').filter(Boolean).pop() || '볼트';
      this.btnVault.title = `볼트 루트로 확장 (${vaultName})`;
    }
  }

  renderTree() {
    const activePath = this.opts.getActiveFilePath();
    this.listEl.innerHTML = '';

    if (!this.rootPath) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';

      const text = document.createElement('p');
      text.className = 'sidebar-empty-text';
      text.textContent = '열려 있는 폴더가 없습니다. 폴더나 파일을 열어 탐색기를 시작하세요.';
      empty.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'sidebar-empty-actions';

      const openFolderBtn = document.createElement('button');
      openFolderBtn.type = 'button';
      openFolderBtn.className = 'sidebar-empty-btn primary';
      openFolderBtn.textContent = '폴더 열기';
      openFolderBtn.title = '폴더 열기 (⌘⌥O)';
      openFolderBtn.addEventListener('click', () => this.opts.postNative({ type: 'openFolder' }));

      const openFileBtn = document.createElement('button');
      openFileBtn.type = 'button';
      openFileBtn.className = 'sidebar-empty-btn';
      openFileBtn.textContent = '파일 열기';
      openFileBtn.title = '파일 열기 (⌘O)';
      openFileBtn.addEventListener('click', () => this.opts.postNative({ type: 'openFile' }));

      actions.appendChild(openFolderBtn);
      actions.appendChild(openFileBtn);
      empty.appendChild(actions);

      this.listEl.appendChild(empty);
      return;
    }

    if (this.filterQuery.trim()) {
      if (this.filterResults.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sidebar-empty';
        empty.textContent = '일치하는 파일이 없습니다.';
        this.listEl.appendChild(empty);
        return;
      }
      for (const item of this.filterResults) {
        this.listEl.appendChild(this.createFlatResultRow(item, activePath));
      }
      return;
    }

    const rootItems = this.childrenCache.get(this.rootPath);
    if (!rootItems) {
      const loading = document.createElement('div');
      loading.className = 'sidebar-empty';
      loading.textContent = '불러오는 중...';
      this.listEl.appendChild(loading);
      return;
    }

    if (rootItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = this.onlyMarkdown ? '표시할 마크다운 파일이 없습니다.' : '표시할 파일이 없습니다.';
      this.listEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    this.appendTreeLevel(frag, rootItems, 0, activePath);
    this.listEl.appendChild(frag);
  }

  private appendTreeLevel(container: DocumentFragment, items: TreeNodeItem[], depth: number, activePath: string) {
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      const kind: FileKind = item.fileKind || (item.isDir ? 'dir' : item.isMarkdown ? 'markdown' : 'external');
      const isExpanded = item.isDir && this.expandedPaths.has(item.path);
      const isActive = !item.isDir && item.path === activePath;

      row.className = `tree-row kind-${kind}`;
      if (item.isDir) row.classList.add('is-dir');
      if (isExpanded) row.classList.add('expanded');
      if (isActive) row.classList.add('active');

      row.style.paddingLeft = `${10 + depth * 12}px`;
      row.title = kind === 'external' ? `${item.path} (클릭 시 기본 앱으로 열기)` : item.path;
      row.setAttribute('role', 'treeitem');
      if (item.isDir) row.setAttribute('aria-expanded', String(isExpanded));

      if (depth > 0) {
        const guide = document.createElement('span');
        guide.className = 'tree-indent-guide';
        guide.style.left = `${10 + (depth - 1) * 12 + 7}px`;
        row.appendChild(guide);
      }

      const chevronSlot = document.createElement('span');
      chevronSlot.className = isExpanded ? 'tree-chevron expanded' : 'tree-chevron';
      if (item.isDir) {
        chevronSlot.innerHTML = CHEVRON_SVG;
      }

      const iconSlot = document.createElement('span');
      iconSlot.className = `tree-icon kind-${kind}`;
      iconSlot.innerHTML = getFileIconSVG(kind);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tree-label';
      nameSpan.textContent = item.name;

      row.appendChild(chevronSlot);
      row.appendChild(iconSlot);
      row.appendChild(nameSpan);

      if (!item.isDir && kind !== 'markdown' && item.ext) {
        const badge = document.createElement('span');
        badge.className = `tree-ext-badge kind-${kind}`;
        badge.textContent = item.ext.toUpperCase().slice(0, 4);
        row.appendChild(badge);
      }

      row.addEventListener('click', () => {
        if (item.isDir) {
          if (this.expandedPaths.has(item.path)) {
            this.expandedPaths.delete(item.path);
          } else {
            this.expandedPaths.add(item.path);
            if (!this.childrenCache.has(item.path)) {
              this.requestChildren(item.path);
            }
          }
          this.renderTree();
        } else {
          this.opts.postNative({ type: 'openFilePath', path: item.path });
        }
      });

      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.openContextMenu(item, event.clientX, event.clientY);
      });

      container.appendChild(row);

      if (isExpanded) {
        const children = this.childrenCache.get(item.path);
        if (children && children.length > 0) {
          this.appendTreeLevel(container, children, depth + 1, activePath);
        } else if (this.loadingPaths.has(item.path)) {
          const loadingRow = document.createElement('div');
          loadingRow.className = 'tree-sub-empty';
          loadingRow.style.paddingLeft = `${26 + (depth + 1) * 12}px`;
          loadingRow.textContent = '불러오는 중...';
          container.appendChild(loadingRow);
        }
      }
    }
  }

  private createFlatResultRow(item: TreeNodeItem, activePath: string): HTMLButtonElement {
    const kind: FileKind = item.fileKind || (item.isMarkdown ? 'markdown' : 'external');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = item.path === activePath ? `tree-row flat kind-${kind} active` : `tree-row flat kind-${kind}`;
    row.title = item.path;

    const iconSlot = document.createElement('span');
    iconSlot.className = `tree-icon kind-${kind}`;
    iconSlot.innerHTML = getFileIconSVG(kind);

    const meta = document.createElement('span');
    meta.className = 'tree-flat-meta';

    const nameEl = document.createElement('span');
    nameEl.className = 'tree-label';
    nameEl.textContent = item.name;

    const subEl = document.createElement('span');
    subEl.className = 'tree-subpath';
    subEl.textContent = item.relPath || item.path;

    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    row.appendChild(iconSlot);
    row.appendChild(meta);

    if (kind !== 'markdown' && item.ext) {
      const badge = document.createElement('span');
      badge.className = `tree-ext-badge kind-${kind}`;
      badge.textContent = item.ext.toUpperCase().slice(0, 4);
      row.appendChild(badge);
    }

    row.addEventListener('click', () => {
      this.opts.postNative({ type: 'openFilePath', path: item.path });
    });

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openContextMenu(item, event.clientX, event.clientY);
    });

    return row;
  }

  // ── Context Menu ──

  private openContextMenu(item: TreeNodeItem, x: number, y: number) {
    this.contextTarget = item;
    const openBtn = this.contextMenuEl.querySelector('button[data-tree-action="open"]') as HTMLButtonElement;
    const defaultBtn = this.contextMenuEl.querySelector('button[data-tree-action="openDefault"]') as HTMLButtonElement;
    const setRootBtn = this.contextMenuEl.querySelector('button[data-tree-action="setRoot"]') as HTMLButtonElement;
    const canTab = !item.isDir && item.fileKind !== 'external';
    openBtn.classList.toggle('hidden', !canTab);
    defaultBtn.classList.toggle('hidden', item.isDir);
    setRootBtn.classList.toggle('hidden', !item.isDir);

    this.contextMenuEl.classList.remove('hidden');
    const rect = this.contextMenuEl.getBoundingClientRect();
    this.contextMenuEl.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, x))}px`;
    this.contextMenuEl.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, y))}px`;
  }

  hideContextMenu() {
    this.contextTarget = null;
    this.contextMenuEl.classList.add('hidden');
  }

  // ── Quick Open (Cmd+K) ──

  openQuickOpen() {
    this.quickBackdrop.classList.remove('hidden');
    this.quickInput.value = '';
    this.quickIndex = 0;
    this.quickInput.focus();
    this.triggerQuickSearch('');
  }

  closeQuickOpen() {
    if (this.quickBackdrop.classList.contains('hidden')) return;
    this.quickBackdrop.classList.add('hidden');
  }

  private triggerQuickSearch(query: string) {
    const searchRoot = this.vaultRootPath || this.rootPath;
    if (!searchRoot) {
      const openTabs = this.opts
        .getOpenTabFiles()
        .filter((t) => t.filePath && (!query || t.fileName.toLowerCase().includes(query.toLowerCase())));
      this.quickResults = openTabs.map((t) => ({
        name: t.fileName,
        path: t.filePath,
        relPath: t.filePath,
        isDir: false,
        isMarkdown: t.fileKind === 'markdown',
        fileKind: t.fileKind,
        ext: t.ext,
      }));
      this.quickIndex = 0;
      this.renderQuickOpenList();
      return;
    }

    const requestId = `qo-${++this.requestSeq}`;
    this.opts.postNative({
      type: 'searchTreeFiles',
      rootPath: searchRoot,
      query,
      onlyMarkdown: false,
      target: 'quickOpen',
      requestId,
    });
  }

  private renderQuickOpenList() {
    this.quickList.innerHTML = '';
    if (this.quickResults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quick-open-empty';
      empty.textContent = '일치하는 파일이 없습니다.';
      this.quickList.appendChild(empty);
      return;
    }

    this.quickResults.forEach((item, idx) => {
      const kind: FileKind = item.fileKind || (item.isMarkdown ? 'markdown' : 'external');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = idx === this.quickIndex ? 'quick-open-item active' : 'quick-open-item';

      const iconSpan = document.createElement('span');
      iconSpan.className = `quick-open-icon kind-${kind}`;
      iconSpan.innerHTML = getFileIconSVG(kind);

      const meta = document.createElement('span');
      meta.className = 'quick-open-meta';

      const nameEl = document.createElement('span');
      nameEl.className = 'quick-open-name';
      nameEl.textContent = item.name;

      const pathEl = document.createElement('span');
      pathEl.className = 'quick-open-path';
      pathEl.textContent = item.relPath || item.path;

      meta.appendChild(nameEl);
      meta.appendChild(pathEl);
      btn.appendChild(iconSpan);
      btn.appendChild(meta);

      if (item.ext) {
        const badge = document.createElement('span');
        badge.className = `tree-ext-badge kind-${kind}`;
        badge.textContent = item.ext.toUpperCase().slice(0, 4);
        btn.appendChild(badge);
      }

      btn.addEventListener('mouseenter', () => {
        this.quickIndex = idx;
        this.quickList.querySelectorAll('.quick-open-item').forEach((el, i) => {
          el.classList.toggle('active', i === idx);
        });
      });

      btn.addEventListener('click', () => {
        this.closeQuickOpen();
        this.opts.postNative({ type: 'openFilePath', path: item.path });
      });

      this.quickList.appendChild(btn);
    });

    const activeEl = this.quickList.querySelector('.quick-open-item.active') as HTMLElement | null;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }

  private bindQuickOpenEvents() {
    this.quickBackdrop.addEventListener('click', (event) => {
      if (event.target === this.quickBackdrop) this.closeQuickOpen();
    });

    this.quickInput.addEventListener('input', () => {
      if (this.quickTimer) window.clearTimeout(this.quickTimer);
      const q = this.quickInput.value;
      this.quickTimer = window.setTimeout(() => this.triggerQuickSearch(q), 90);
    });

    this.quickInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeQuickOpen();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (this.quickResults.length > 0) {
          this.quickIndex = (this.quickIndex + 1) % this.quickResults.length;
          this.renderQuickOpenList();
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.quickResults.length > 0) {
          this.quickIndex = (this.quickIndex - 1 + this.quickResults.length) % this.quickResults.length;
          this.renderQuickOpenList();
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = this.quickResults[this.quickIndex];
        if (selected) {
          this.closeQuickOpen();
          this.opts.postNative({ type: 'openFilePath', path: selected.path });
        }
      }
    });
  }

  // ── Events & Resizer ──

  private bindEvents() {
    this.btnMdOnly.addEventListener('click', () => {
      this.onlyMarkdown = !this.onlyMarkdown;
      this.updateMdOnlyButton();
      try {
        window.localStorage.setItem(TREE_MD_ONLY_KEY, String(this.onlyMarkdown));
      } catch {
        // Ignore
      }
      this.refreshTree(true);
      this.opts.showToast(this.onlyMarkdown ? '마크다운(.md) 파일만 표시' : '모든 파일 형식 표시');
    });

    this.btnUp.addEventListener('click', () => {
      if (this.parentPath) {
        this.setRoot(this.parentPath, this.opts.getActiveFilePath());
      }
    });

    this.btnVault.addEventListener('click', () => {
      if (this.vaultRootPath) {
        this.setRoot(this.vaultRootPath, this.opts.getActiveFilePath());
      }
    });

    this.btnRevealActive.addEventListener('click', () => {
      this.revealActiveFile();
    });

    this.btnRefresh.addEventListener('click', () => this.refreshTree());

    this.filterInput.addEventListener('input', () => {
      this.filterQuery = this.filterInput.value;
      this.filterClearBtn.classList.toggle('hidden', !this.filterQuery);
      if (this.filterTimer) window.clearTimeout(this.filterTimer);
      if (!this.filterQuery.trim()) {
        this.filterResults = [];
        this.renderTree();
        return;
      }
      if (!this.rootPath) return;
      this.filterTimer = window.setTimeout(() => this.triggerTreeFilterSearch(), 110);
    });

    this.filterClearBtn.addEventListener('click', () => {
      this.filterInput.value = '';
      this.filterQuery = '';
      this.filterResults = [];
      this.filterClearBtn.classList.add('hidden');
      this.renderTree();
      this.filterInput.focus();
    });

    this.contextMenuEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest('button[data-tree-action]') as HTMLButtonElement | null;
      if (!btn || !this.contextTarget) return;
      const target = this.contextTarget;
      this.hideContextMenu();
      switch (btn.dataset.treeAction) {
        case 'open':
          this.opts.postNative({ type: 'openFilePath', path: target.path });
          break;
        case 'openDefault':
          this.opts.postNative({ type: 'openWithDefaultApp', path: target.path });
          break;
        case 'setRoot':
          this.setRoot(target.path, this.opts.getActiveFilePath());
          break;
        case 'copyPath':
          this.opts.postNative({ type: 'copyText', text: target.path });
          this.opts.showToast('경로 복사됨');
          break;
        case 'reveal':
          this.opts.postNative({ type: 'revealInFinder', path: target.path });
          break;
      }
    });

    window.addEventListener('click', (event) => {
      if (!this.contextMenuEl.classList.contains('hidden')) {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('#tree-context-menu')) {
          this.hideContextMenu();
        }
      }
    });
  }

  private bindResizer() {
    let dragging = false;
    let startX = 0;
    let startWidth = 252;

    this.resizerEl.addEventListener('mousedown', (event) => {
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startWidth = this.sidebarEl.getBoundingClientRect().width;
      this.resizerEl.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      const nextWidth = Math.min(440, Math.max(180, startWidth + (event.clientX - startX)));
      this.sidebarEl.style.width = `${nextWidth}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      this.resizerEl.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const finalWidth = Math.round(this.sidebarEl.getBoundingClientRect().width);
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
      } catch {
        // Ignore
      }
    });
  }
}
