import type { BacklinkItem, BacklinksPayload } from '../types';
import { bindPanelResizer } from './panel-resizer';

export type InspectorTab = 'outline' | 'tasks' | 'links';

export interface InspectorOptions {
  postNative: (payload: Record<string, unknown>) => void;
  getActiveTabInfo: () => { filePath: string; fileName: string; fileKind: string } | null;
  getRichEditorEl: () => HTMLElement;
  onOutlineRefresh: () => void;
  onOpenLink: (target: string, isWiki: boolean) => void;
}

const INSPECTOR_OPEN_KEY = 'emdi:inspectorOpen';
const INSPECTOR_WIDTH_KEY = 'emdi:inspectorWidth';
const INSPECTOR_TAB_KEY = 'emdi:inspectorTab';

export class InspectorController {
  private readonly opts: InspectorOptions;

  private readonly panelEl = document.getElementById('inspector-panel') as HTMLElement;
  private readonly resizerEl = document.getElementById('inspector-resizer') as HTMLDivElement;
  private readonly btnToggle = document.getElementById('btn-inspector-toggle') as HTMLButtonElement;
  private readonly btnClose = document.getElementById('btn-inspector-close') as HTMLButtonElement;

  private readonly tabOutlineBtn = document.getElementById('inspector-tab-outline') as HTMLButtonElement;
  private readonly tabTasksBtn = document.getElementById('inspector-tab-tasks') as HTMLButtonElement;
  private readonly tabLinksBtn = document.getElementById('inspector-tab-links') as HTMLButtonElement;

  private readonly paneOutline = document.getElementById('inspector-pane-outline') as HTMLElement;
  private readonly paneTasks = document.getElementById('inspector-pane-tasks') as HTMLElement;
  private readonly paneLinks = document.getElementById('inspector-pane-links') as HTMLElement;

  private readonly summaryCharsEl = document.getElementById('ins-stat-chars') as HTMLElement;
  private readonly summaryReadEl = document.getElementById('ins-stat-read') as HTMLElement;
  private readonly summaryTasksEl = document.getElementById('ins-stat-tasks') as HTMLElement;

  private readonly tasksListEl = document.getElementById('inspector-tasks-list') as HTMLElement;
  private readonly tasksBadgeEl = document.getElementById('inspector-tasks-badge') as HTMLElement;
  private readonly outgoingListEl = document.getElementById('inspector-outgoing-list') as HTMLElement;
  private readonly backlinksListEl = document.getElementById('inspector-backlinks-list') as HTMLElement;

  private openState = false;
  private activeTab: InspectorTab = 'outline';
  private backlinksSeq = 0;
  private lastBacklinksPath = '';
  private backlinksItems: BacklinkItem[] = [];
  private backlinksLoading = false;

  constructor(opts: InspectorOptions) {
    this.opts = opts;
    this.restorePrefs();
    this.bindEvents();
    this.bindResizer();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  private restorePrefs() {
    try {
      const savedW = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
      if (savedW >= 210 && savedW <= 440) {
        this.panelEl.style.width = `${savedW}px`;
      }
      const savedTab = window.localStorage.getItem(INSPECTOR_TAB_KEY) as InspectorTab | null;
      if (savedTab === 'outline' || savedTab === 'tasks' || savedTab === 'links') {
        this.activeTab = savedTab;
      }
      const savedOpen = window.localStorage.getItem(INSPECTOR_OPEN_KEY);
      this.setOpen(savedOpen === 'true', false);
    } catch {
      this.setOpen(false, false);
    }
    this.setTab(this.activeTab, false);
  }

  setOpen(open: boolean, persist = true) {
    this.openState = open;
    this.panelEl.classList.toggle('collapsed', !open);
    this.resizerEl.classList.toggle('hidden', !open);
    this.btnToggle.classList.toggle('active', open);
    if (persist) {
      try {
        window.localStorage.setItem(INSPECTOR_OPEN_KEY, String(open));
      } catch {
        // Ignore
      }
    }
    if (open) {
      this.refreshAll(true);
    }
  }

  toggle() {
    this.setOpen(!this.openState);
  }

  openTab(tab: InspectorTab) {
    if (this.openState && this.activeTab === tab) {
      this.setOpen(false);
      return;
    }
    this.setTab(tab, true);
    this.setOpen(true);
  }

  setTab(tab: InspectorTab, persist = true) {
    this.activeTab = tab;
    this.tabOutlineBtn.classList.toggle('active', tab === 'outline');
    this.tabTasksBtn.classList.toggle('active', tab === 'tasks');
    this.tabLinksBtn.classList.toggle('active', tab === 'links');

    this.paneOutline.classList.toggle('hidden', tab !== 'outline');
    this.paneTasks.classList.toggle('hidden', tab !== 'tasks');
    this.paneLinks.classList.toggle('hidden', tab !== 'links');

    if (persist) {
      try {
        window.localStorage.setItem(INSPECTOR_TAB_KEY, tab);
      } catch {
        // Ignore
      }
    }

    if (this.openState) {
      this.refreshAll(tab === 'links');
    }
  }

  refreshAll(forceBacklinks = false) {
    const info = this.opts.getActiveTabInfo();
    this.updateSummary(info);
    if (!this.openState) return;

    if (this.activeTab === 'outline') {
      this.opts.onOutlineRefresh();
    } else if (this.activeTab === 'tasks') {
      this.renderTasks(info);
    } else if (this.activeTab === 'links') {
      this.renderOutgoingLinks(info);
      this.requestBacklinks(info, forceBacklinks);
    }
  }

  onBacklinksLoaded(payload: BacklinksPayload) {
    const info = this.opts.getActiveTabInfo();
    if (!info || payload.filePath !== info.filePath) return;
    this.backlinksLoading = false;
    this.backlinksItems = payload.items || [];
    this.renderBacklinks(info);
  }

  private updateSummary(info: { filePath: string; fileName: string; fileKind: string } | null) {
    if (!info || info.fileKind !== 'markdown') {
      this.summaryCharsEl.textContent = '-';
      this.summaryReadEl.textContent = '-';
      this.summaryTasksEl.textContent = '-';
      this.tasksBadgeEl.classList.add('hidden');
      return;
    }

    const root = this.opts.getRichEditorEl();
    const text = (root.textContent ?? '').trim();
    const chars = text.replace(/\s/g, '').length;
    const readMin = Math.max(1, Math.ceil(chars / 450));

    const taskNodes = root.querySelectorAll<HTMLLIElement>('ul[data-type="taskList"] li');
    const totalTasks = taskNodes.length;
    let doneTasks = 0;
    taskNodes.forEach((li) => {
      if (li.getAttribute('data-checked') === 'true') doneTasks += 1;
    });

    this.summaryCharsEl.textContent = `${chars.toLocaleString()}자`;
    this.summaryReadEl.textContent = chars === 0 ? '0분' : `약 ${readMin}분`;
    this.summaryTasksEl.textContent = totalTasks > 0 ? `${doneTasks}/${totalTasks}` : '없음';

    const pending = totalTasks - doneTasks;
    if (pending > 0) {
      this.tasksBadgeEl.textContent = String(pending);
      this.tasksBadgeEl.classList.remove('hidden');
    } else {
      this.tasksBadgeEl.classList.add('hidden');
    }
  }

  private renderTasks(info: { filePath: string; fileName: string; fileKind: string } | null) {
    this.tasksListEl.innerHTML = '';
    if (!info || info.fileKind !== 'markdown') {
      this.tasksListEl.innerHTML = '<div class="inspector-empty">마크다운 문서의 체크박스가 여기에 표시됩니다.</div>';
      return;
    }

    const root = this.opts.getRichEditorEl();
    const taskNodes = Array.from(root.querySelectorAll<HTMLLIElement>('ul[data-type="taskList"] li'));
    if (taskNodes.length === 0) {
      this.tasksListEl.innerHTML = '<div class="inspector-empty">이 문서에 할 일 항목(- [ ])이 없습니다.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const li of taskNodes) {
      const checked = li.getAttribute('data-checked') === 'true';
      const contentDiv = li.querySelector<HTMLElement>(':scope > div');
      const rawText = (contentDiv?.textContent ?? '').trim() || '(내용 없음)';

      const row = document.createElement('div');
      row.className = `ins-task-row${checked ? ' done' : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ins-task-check';
      cb.checked = checked;
      cb.addEventListener('change', () => {
        const realInput = li.querySelector<HTMLInputElement>(':scope > label input[type="checkbox"]');
        realInput?.click();
        setTimeout(() => this.refreshAll(false), 30);
      });

      const labelBtn = document.createElement('button');
      labelBtn.type = 'button';
      labelBtn.className = 'ins-task-text';
      labelBtn.textContent = rawText;
      labelBtn.title = rawText;
      labelBtn.addEventListener('click', () => {
        li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        li.classList.remove('anchor-flash');
        void li.offsetWidth;
        li.classList.add('anchor-flash');
      });

      row.appendChild(cb);
      row.appendChild(labelBtn);
      frag.appendChild(row);
    }
    this.tasksListEl.appendChild(frag);
  }

  private renderOutgoingLinks(info: { filePath: string; fileName: string; fileKind: string } | null) {
    this.outgoingListEl.innerHTML = '';
    if (!info || info.fileKind !== 'markdown') {
      this.outgoingListEl.innerHTML = '<div class="inspector-empty">마크다운 문서에서 링크가 표시됩니다.</div>';
      return;
    }

    const root = this.opts.getRichEditorEl();
    const seen = new Set<string>();
    const items: { label: string; target: string; isWiki: boolean }[] = [];

    root.querySelectorAll<HTMLElement>('[data-wikilink="true"]').forEach((el) => {
      const target = (el.getAttribute('data-wiki-target') ?? el.textContent ?? '').trim();
      if (!target || seen.has(`w:${target}`)) return;
      seen.add(`w:${target}`);
      items.push({ label: (el.textContent ?? target).trim(), target, isWiki: true });
    });

    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const href = (a.getAttribute('href') ?? '').trim();
      if (!href || href.startsWith('#') || seen.has(`a:${href}`)) return;
      seen.add(`a:${href}`);
      const label = (a.textContent ?? href).trim() || href;
      items.push({ label, target: href, isWiki: false });
    });

    if (items.length === 0) {
      this.outgoingListEl.innerHTML = '<div class="inspector-empty">이 문서에 연결된 링크가 없습니다.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ins-link-row';
      btn.title = item.target;

      const badge = document.createElement('span');
      badge.className = `ins-link-badge${item.isWiki ? ' wiki' : ''}`;
      badge.textContent = item.isWiki ? '[[' : '↗';

      const name = document.createElement('span');
      name.className = 'ins-link-label';
      name.textContent = item.label;

      btn.appendChild(badge);
      btn.appendChild(name);
      btn.addEventListener('click', () => this.opts.onOpenLink(item.target, item.isWiki));
      frag.appendChild(btn);
    }
    this.outgoingListEl.appendChild(frag);
  }

  private requestBacklinks(info: { filePath: string; fileName: string; fileKind: string } | null, force: boolean) {
    if (!info || !info.filePath || info.fileKind !== 'markdown') {
      this.backlinksItems = [];
      this.lastBacklinksPath = '';
      this.backlinksLoading = false;
      this.renderBacklinks(info);
      return;
    }

    if (!force && this.lastBacklinksPath === info.filePath) {
      this.renderBacklinks(info);
      return;
    }

    this.lastBacklinksPath = info.filePath;
    this.backlinksLoading = true;
    this.renderBacklinks(info);

    const requestId = `bl-${++this.backlinksSeq}`;
    this.opts.postNative({
      type: 'findBacklinks',
      filePath: info.filePath,
      requestId,
    });
  }

  private renderBacklinks(info: { filePath: string; fileName: string; fileKind: string } | null) {
    this.backlinksListEl.innerHTML = '';
    if (!info || !info.filePath || info.fileKind !== 'markdown') {
      this.backlinksListEl.innerHTML = '<div class="inspector-empty">저장된 마크다운 파일에서 백링크를 탐색합니다.</div>';
      return;
    }

    if (this.backlinksLoading) {
      this.backlinksListEl.innerHTML = '<div class="inspector-empty">연결된 노트 찾는 중...</div>';
      return;
    }

    if (this.backlinksItems.length === 0) {
      this.backlinksListEl.innerHTML = '<div class="inspector-empty">이 노트를 참조하는 문서가 없습니다.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of this.backlinksItems) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ins-backlink-row';
      btn.title = item.path;

      const title = document.createElement('span');
      title.className = 'ins-backlink-name';
      title.textContent = item.name;
      btn.appendChild(title);

      if (item.relPath) {
        const sub = document.createElement('span');
        sub.className = 'ins-backlink-path';
        sub.textContent = item.relPath;
        btn.appendChild(sub);
      }

      if (item.snippet) {
        const snip = document.createElement('span');
        snip.className = 'ins-backlink-snippet';
        snip.textContent = item.snippet;
        btn.appendChild(snip);
      }

      btn.addEventListener('click', () => {
        this.opts.postNative({ type: 'openFilePath', path: item.path });
      });
      frag.appendChild(btn);
    }
    this.backlinksListEl.appendChild(frag);
  }

  private bindEvents() {
    this.btnToggle.addEventListener('click', () => this.toggle());
    this.btnClose.addEventListener('click', () => this.setOpen(false));
    this.tabOutlineBtn.addEventListener('click', () => this.setTab('outline'));
    this.tabTasksBtn.addEventListener('click', () => this.setTab('tasks'));
    this.tabLinksBtn.addEventListener('click', () => this.setTab('links'));
  }

  private bindResizer() {
    bindPanelResizer({
      resizerEl: this.resizerEl,
      panelEl: this.panelEl,
      direction: 'right',
      minWidth: 210,
      maxWidth: 440,
      defaultWidth: 268,
      storageKey: INSPECTOR_WIDTH_KEY,
    });
  }
}
