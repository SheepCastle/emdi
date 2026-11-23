import type { Editor } from '@tiptap/core';

interface SlashItem {
  id: string;
  title: string;
  desc: string;
  badge: string;
  keywords: string[];
  run: (editor: Editor) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'h1',
    title: '제목 1',
    desc: '큰 섹션 제목',
    badge: 'H1',
    keywords: ['h1', 'heading', '제목', '헤딩', '1'],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: '제목 2',
    desc: '중간 섹션 제목',
    badge: 'H2',
    keywords: ['h2', 'heading', '제목', '헤딩', '2'],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: '제목 3',
    desc: '하위 섹션 제목',
    badge: 'H3',
    keywords: ['h3', 'heading', '제목', '헤딩', '3'],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    title: '글머리 목록',
    desc: '기본 점 목록',
    badge: '•',
    keywords: ['bullet', 'list', 'ul', '목록', '리스트'],
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: '번호 목록',
    desc: '순서가 있는 목록',
    badge: '1.',
    keywords: ['ordered', 'number', 'ol', '번호', '목록'],
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task',
    title: '체크리스트',
    desc: '할 일 체크박스 목록',
    badge: '☑',
    keywords: ['task', 'todo', 'check', '체크', '할일'],
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'table',
    title: '표 (3×3)',
    desc: '헤더 포함 표 삽입',
    badge: '⊞',
    keywords: ['table', '표', '테이블'],
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'code',
    title: '코드 블록',
    desc: '문법 하이라이팅 코드',
    badge: '</>',
    keywords: ['code', 'snippet', '코드', '코드블록'],
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'mermaid',
    title: 'Mermaid 다이어그램',
    desc: '흐름도 및 아키텍처 다이어그램',
    badge: '◇',
    keywords: ['mermaid', 'diagram', 'chart', '다이어그램', '구조도', '차트'],
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'flowchart LR\n  A[시작] --> B[완료]' }],
        })
        .run();
    },
  },
  {
    id: 'quote',
    title: '인용구',
    desc: '인용 블록',
    badge: '❝',
    keywords: ['quote', 'blockquote', '인용', '인용구'],
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'callout-note',
    title: '콜아웃 (NOTE)',
    desc: 'Obsidian 안내 카드',
    badge: 'i',
    keywords: ['callout', 'note', 'info', '콜아웃', '노트', '안내'],
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '[!NOTE] 참고' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '여기에 안내 내용을 입력하세요.' }] },
          ],
        })
        .run();
    },
  },
  {
    id: 'callout-warning',
    title: '콜아웃 (WARNING)',
    desc: '주의 및 경고 카드',
    badge: '!',
    keywords: ['callout', 'warning', 'warn', '경고', '주의', '콜아웃'],
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '[!WARNING] 주의' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '확인이 필요한 내용을 입력하세요.' }] },
          ],
        })
        .run();
    },
  },
  {
    id: 'hr',
    title: '구분선',
    desc: '수평 구분선',
    badge: '―',
    keywords: ['hr', 'divider', 'line', '구분선'],
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

export class FloatingToolsController {
  private readonly editor: Editor;
  private readonly isSourceMode: () => boolean;
  private readonly editorScrollEl: HTMLElement;

  // Bubble Menu
  private readonly bubbleEl = document.getElementById('bubble-menu') as HTMLDivElement;
  private readonly bubbleButtonsEl = document.getElementById('bubble-buttons') as HTMLDivElement;
  private readonly bubbleLinkForm = document.getElementById('bubble-link-form') as HTMLDivElement;
  private readonly bubbleLinkInput = document.getElementById('bubble-link-input') as HTMLInputElement;
  private readonly bubbleLinkApply = document.getElementById('bubble-link-apply') as HTMLButtonElement;
  private readonly bubbleLinkRemove = document.getElementById('bubble-link-remove') as HTMLButtonElement;
  private linkFormOpen = false;

  // Slash Menu
  private readonly slashEl = document.getElementById('slash-menu') as HTMLDivElement;
  private slashActive = false;
  private slashRange: { from: number; to: number } | null = null;
  private slashFiltered: SlashItem[] = [];
  private slashIndex = 0;

  // Table Toolbar
  private readonly tableBarEl = document.getElementById('table-toolbar') as HTMLDivElement;

  constructor(opts: { editor: Editor; isSourceMode: () => boolean; editorScrollEl: HTMLElement }) {
    this.editor = opts.editor;
    this.isSourceMode = opts.isSourceMode;
    this.editorScrollEl = opts.editorScrollEl;
    this.bindBubbleEvents();
    this.bindTableEvents();
    this.bindEditorEvents();
  }

  hideAll() {
    this.hideBubble();
    this.hideSlash();
    this.tableBarEl.classList.add('hidden');
  }

  openLinkEditor() {
    if (this.isSourceMode()) return;
    this.hideSlash();
    const { from, to } = this.editor.state.selection;
    try {
      const startCoords = this.editor.view.coordsAtPos(from);
      const endCoords = this.editor.view.coordsAtPos(to);
      const midX = (startCoords.left + endCoords.right) / 2;
      const topY = Math.min(startCoords.top, endCoords.top);
      this.bubbleEl.classList.remove('hidden');
      this.openLinkForm();
      const rect = this.bubbleEl.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - rect.width - 12, midX - rect.width / 2));
      const top = Math.max(48, topY - rect.height - 10);
      this.bubbleEl.style.left = `${left}px`;
      this.bubbleEl.style.top = `${top}px`;
    } catch {
      this.bubbleEl.classList.remove('hidden');
      this.openLinkForm();
    }
  }

  // ── Bubble Menu ──

  private bindBubbleEvents() {
    this.bubbleEl.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return;
      event.preventDefault();
    });

    this.bubbleButtonsEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest('button[data-cmd]') as HTMLButtonElement | null;
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      switch (cmd) {
        case 'bold':
          this.editor.chain().focus().toggleBold().run();
          break;
        case 'italic':
          this.editor.chain().focus().toggleItalic().run();
          break;
        case 'strike':
          this.editor.chain().focus().toggleStrike().run();
          break;
        case 'code':
          this.editor.chain().focus().toggleCode().run();
          break;
        case 'highlight':
          this.editor.chain().focus().toggleHighlight().run();
          break;
        case 'h1':
          this.editor.chain().focus().toggleHeading({ level: 1 }).run();
          break;
        case 'h2':
          this.editor.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case 'h3':
          this.editor.chain().focus().toggleHeading({ level: 3 }).run();
          break;
        case 'link':
          this.openLinkForm();
          return;
      }
      this.updateBubbleActiveStates();
    });

    this.bubbleLinkApply.addEventListener('click', () => this.applyLink());
    this.bubbleLinkRemove.addEventListener('click', () => {
      this.editor.chain().focus().unsetLink().run();
      this.closeLinkForm();
    });
    this.bubbleLinkInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.applyLink();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeLinkForm();
        this.editor.commands.focus();
      }
    });
  }

  private openLinkForm() {
    this.linkFormOpen = true;
    const currentHref = (this.editor.getAttributes('link').href as string | undefined) ?? '';
    this.bubbleLinkInput.value = currentHref;
    this.bubbleButtonsEl.classList.add('hidden');
    this.bubbleLinkForm.classList.remove('hidden');
    this.bubbleLinkInput.focus();
    this.bubbleLinkInput.select();
  }

  private closeLinkForm() {
    this.linkFormOpen = false;
    this.bubbleLinkForm.classList.add('hidden');
    this.bubbleButtonsEl.classList.remove('hidden');
  }

  private applyLink() {
    const raw = this.bubbleLinkInput.value.trim();
    if (!raw) {
      this.editor.chain().focus().unsetLink().run();
    } else {
      this.editor.chain().focus().extendMarkRange('link').setLink({ href: raw }).run();
    }
    this.closeLinkForm();
    this.hideBubble();
  }

  private hideBubble() {
    this.closeLinkForm();
    this.bubbleEl.classList.add('hidden');
  }

  private updateBubbleActiveStates() {
    const checks: Record<string, boolean> = {
      bold: this.editor.isActive('bold'),
      italic: this.editor.isActive('italic'),
      strike: this.editor.isActive('strike'),
      code: this.editor.isActive('code'),
      highlight: this.editor.isActive('highlight'),
      h1: this.editor.isActive('heading', { level: 1 }),
      h2: this.editor.isActive('heading', { level: 2 }),
      h3: this.editor.isActive('heading', { level: 3 }),
      link: this.editor.isActive('link'),
    };
    this.bubbleButtonsEl.querySelectorAll('button[data-cmd]').forEach((el) => {
      const btn = el as HTMLButtonElement;
      const cmd = btn.dataset.cmd ?? '';
      btn.classList.toggle('active', Boolean(checks[cmd]));
    });
  }

  private updateBubblePosition() {
    if (this.isSourceMode() || this.slashActive) {
      this.hideBubble();
      return;
    }

    const { from, to, empty } = this.editor.state.selection;
    if (empty || this.editor.isActive('codeBlock')) {
      if (!this.linkFormOpen) this.hideBubble();
      return;
    }

    const selectedText = this.editor.state.doc.textBetween(from, to, '').trim();
    if (!selectedText) {
      if (!this.linkFormOpen) this.hideBubble();
      return;
    }

    try {
      const startCoords = this.editor.view.coordsAtPos(from);
      const endCoords = this.editor.view.coordsAtPos(to);
      const midX = (startCoords.left + endCoords.right) / 2;
      const topY = Math.min(startCoords.top, endCoords.top);

      this.bubbleEl.classList.remove('hidden');
      this.updateBubbleActiveStates();

      const rect = this.bubbleEl.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - rect.width - 12, midX - rect.width / 2));
      const top = Math.max(48, topY - rect.height - 10);

      this.bubbleEl.style.left = `${left}px`;
      this.bubbleEl.style.top = `${top}px`;
    } catch {
      this.hideBubble();
    }
  }

  // ── Table Toolbar ──

  private bindTableEvents() {
    this.tableBarEl.addEventListener('mousedown', (event) => event.preventDefault());
    this.tableBarEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest('button[data-tcmd]') as HTMLButtonElement | null;
      if (!btn) return;
      switch (btn.dataset.tcmd) {
        case 'addRowBefore':
          this.editor.chain().focus().addRowBefore().run();
          break;
        case 'addRowAfter':
          this.editor.chain().focus().addRowAfter().run();
          break;
        case 'addColBefore':
          this.editor.chain().focus().addColumnBefore().run();
          break;
        case 'addColAfter':
          this.editor.chain().focus().addColumnAfter().run();
          break;
        case 'delRow':
          this.editor.chain().focus().deleteRow().run();
          break;
        case 'delCol':
          this.editor.chain().focus().deleteColumn().run();
          break;
        case 'delTable':
          this.editor.chain().focus().deleteTable().run();
          break;
      }
      this.updateTableToolbar();
    });
  }

  private updateTableToolbar() {
    if (this.isSourceMode() || !this.editor.isActive('table')) {
      this.tableBarEl.classList.add('hidden');
      return;
    }

    try {
      const { from } = this.editor.state.selection;
      const domAt = this.editor.view.domAtPos(from);
      const baseEl =
        domAt.node.nodeType === Node.ELEMENT_NODE
          ? (domAt.node as HTMLElement)
          : domAt.node.parentElement;
      const tableWrapper = (baseEl?.closest('.tableWrapper') ?? baseEl?.closest('table')) as HTMLElement | null;
      if (!tableWrapper) {
        this.tableBarEl.classList.add('hidden');
        return;
      }

      const rect = tableWrapper.getBoundingClientRect();
      if (rect.bottom < 80 || rect.top > window.innerHeight - 20) {
        this.tableBarEl.classList.add('hidden');
        return;
      }

      this.tableBarEl.classList.remove('hidden');
      const barRect = this.tableBarEl.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - barRect.width - 12, rect.left));
      const top = Math.max(48, rect.top - barRect.height - 6);
      this.tableBarEl.style.left = `${left}px`;
      this.tableBarEl.style.top = `${top}px`;
    } catch {
      this.tableBarEl.classList.add('hidden');
    }
  }

  // ── Slash Command Menu ──

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.slashActive) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.slashIndex = (this.slashIndex + 1) % Math.max(1, this.slashFiltered.length);
      this.renderSlashItems();
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const len = Math.max(1, this.slashFiltered.length);
      this.slashIndex = (this.slashIndex - 1 + len) % len;
      this.renderSlashItems();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const item = this.slashFiltered[this.slashIndex];
      if (item) this.executeSlashItem(item);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hideSlash();
      return true;
    }
    return false;
  }

  private hideSlash() {
    this.slashActive = false;
    this.slashRange = null;
    this.slashEl.classList.add('hidden');
  }

  private updateSlashMenu() {
    if (this.isSourceMode() || this.editor.isActive('codeBlock')) {
      this.hideSlash();
      return;
    }

    const { from, empty } = this.editor.state.selection;
    if (!empty) {
      this.hideSlash();
      return;
    }

    const $from = this.editor.state.doc.resolve(from);
    if ($from.parent.type.name !== 'paragraph') {
      this.hideSlash();
      return;
    }

    const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\uFFFC', '\uFFFC');
    const match = textBefore.match(/(?:^|\s)\/([^\s/]{0,20})$/);
    if (!match) {
      this.hideSlash();
      return;
    }

    const query = match[1].toLowerCase();
    const slashStart = from - match[1].length - 1;
    const filtered = SLASH_ITEMS.filter((item) => {
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.desc.toLowerCase().includes(query) ||
        item.keywords.some((k) => k.toLowerCase().includes(query))
      );
    });

    if (filtered.length === 0) {
      this.hideSlash();
      return;
    }

    this.slashActive = true;
    this.slashRange = { from: slashStart, to: from };
    this.slashFiltered = filtered;
    if (this.slashIndex >= filtered.length) this.slashIndex = 0;

    this.renderSlashItems();
    this.positionSlashMenu(from);
  }

  private renderSlashItems() {
    this.slashEl.innerHTML = '';
    this.slashFiltered.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = idx === this.slashIndex ? 'slash-item active' : 'slash-item';
      btn.innerHTML = `<span class="slash-badge">${item.badge}</span><span class="slash-meta"><span class="slash-title">${item.title}</span><span class="slash-desc">${item.desc}</span></span>`;
      btn.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.executeSlashItem(item);
      });
      btn.addEventListener('mouseenter', () => {
        this.slashIndex = idx;
        this.slashEl.querySelectorAll('.slash-item').forEach((el, i) => {
          el.classList.toggle('active', i === idx);
        });
      });
      this.slashEl.appendChild(btn);
    });
  }

  private positionSlashMenu(pos: number) {
    try {
      const coords = this.editor.view.coordsAtPos(pos);
      this.slashEl.classList.remove('hidden');
      const rect = this.slashEl.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - rect.width - 12, coords.left));
      let top = coords.bottom + 6;
      if (top + rect.height > window.innerHeight - 16) {
        top = Math.max(48, coords.top - rect.height - 6);
      }
      this.slashEl.style.left = `${left}px`;
      this.slashEl.style.top = `${top}px`;
    } catch {
      this.hideSlash();
    }
  }

  private executeSlashItem(item: SlashItem) {
    const range = this.slashRange;
    this.hideSlash();
    if (range) {
      this.editor.chain().focus().deleteRange(range).run();
    }
    item.run(this.editor);
  }

  // ── Hook into Editor & Scroll ──

  private bindEditorEvents() {
    this.editor.on('selectionUpdate', () => {
      this.updateSlashMenu();
      this.updateBubblePosition();
      this.updateTableToolbar();
    });

    this.editor.on('update', () => {
      this.updateSlashMenu();
      this.updateTableToolbar();
    });

    this.editor.on('blur', () => {
      window.setTimeout(() => {
        if (!this.linkFormOpen && !this.bubbleEl.contains(document.activeElement)) {
          this.hideBubble();
        }
        if (!this.slashEl.contains(document.activeElement)) {
          this.hideSlash();
        }
      }, 120);
    });

    this.editorScrollEl.addEventListener('scroll', () => {
      if (!this.bubbleEl.classList.contains('hidden')) this.updateBubblePosition();
      if (!this.tableBarEl.classList.contains('hidden')) this.updateTableToolbar();
      if (this.slashActive) this.hideSlash();
    });
  }
}
