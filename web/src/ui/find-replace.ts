import type { Editor } from '@tiptap/core';
import { searchPluginKey, type SearchMatch } from '../extensions';

export interface FindReplaceOptions {
  editor: Editor;
  sourceEditorEl: HTMLTextAreaElement;
  isSourceMode: () => boolean;
  onSourceMutated: () => void;
  showToast: (msg: string) => void;
}

export class FindReplaceController {
  private readonly barEl = document.getElementById('find-bar') as HTMLDivElement;
  private readonly findInput = document.getElementById('find-input') as HTMLInputElement;
  private readonly replaceInput = document.getElementById('replace-input') as HTMLInputElement;
  private readonly replaceRow = document.getElementById('replace-row') as HTMLDivElement;
  private readonly toggleReplaceBtn = document.getElementById('btn-find-toggle-replace') as HTMLButtonElement;
  private readonly caseBtn = document.getElementById('btn-find-case') as HTMLButtonElement;
  private readonly countEl = document.getElementById('find-count') as HTMLSpanElement;
  private readonly prevBtn = document.getElementById('btn-find-prev') as HTMLButtonElement;
  private readonly nextBtn = document.getElementById('btn-find-next') as HTMLButtonElement;
  private readonly closeBtn = document.getElementById('btn-find-close') as HTMLButtonElement;
  private readonly replaceOneBtn = document.getElementById('btn-replace-one') as HTMLButtonElement;
  private readonly replaceAllBtn = document.getElementById('btn-replace-all') as HTMLButtonElement;

  private readonly opts: FindReplaceOptions;
  private caseSensitive = false;
  private sourceMatches: { start: number; end: number }[] = [];
  private activeIndex = 0;

  constructor(opts: FindReplaceOptions) {
    this.opts = opts;
    this.bindEvents();
  }

  get isOpen(): boolean {
    return !this.barEl.classList.contains('hidden');
  }

  private bindEvents() {
    this.findInput.addEventListener('input', () => {
      this.activeIndex = 0;
      this.refresh(true);
    });

    this.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) this.prev();
        else this.next();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.replaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.replaceOne();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.toggleReplaceBtn.addEventListener('click', () => {
      const hidden = this.replaceRow.classList.toggle('hidden');
      this.toggleReplaceBtn.textContent = hidden ? '▸' : '▾';
      if (!hidden) this.replaceInput.focus();
    });

    this.caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.classList.toggle('active', this.caseSensitive);
      this.activeIndex = 0;
      this.refresh(true);
    });

    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());
    this.closeBtn.addEventListener('click', () => this.close());
    this.replaceOneBtn.addEventListener('click', () => this.replaceOne());
    this.replaceAllBtn.addEventListener('click', () => this.replaceAll());
  }

  open(withReplace = false) {
    this.barEl.classList.remove('hidden');
    if (withReplace) {
      this.replaceRow.classList.remove('hidden');
      this.toggleReplaceBtn.textContent = '▾';
    }

    // Seed search input with currently selected short text if any
    let selected = '';
    if (this.opts.isSourceMode()) {
      const el = this.opts.sourceEditorEl;
      if (el.selectionEnd > el.selectionStart) {
        selected = el.value.slice(el.selectionStart, el.selectionEnd);
      }
    } else {
      const { from, to } = this.opts.editor.state.selection;
      if (to > from) {
        selected = this.opts.editor.state.doc.textBetween(from, to, ' ');
      }
    }
    if (selected && !selected.includes('\n') && selected.length < 80) {
      this.findInput.value = selected;
    }

    this.findInput.focus();
    this.findInput.select();
    this.refresh(true);
  }

  close() {
    if (!this.isOpen) return;
    this.barEl.classList.add('hidden');
    this.clearHighlights();
    if (this.opts.isSourceMode()) {
      this.opts.sourceEditorEl.focus();
    } else {
      this.opts.editor.commands.focus();
    }
  }

  clearHighlights() {
    this.sourceMatches = [];
    this.activeIndex = 0;
    this.countEl.textContent = '0/0';
    const tr = this.opts.editor.state.tr.setMeta(searchPluginKey, {
      query: '',
      caseSensitive: this.caseSensitive,
      activeIndex: 0,
    });
    this.opts.editor.view.dispatch(tr);
  }

  refresh(scrollToActive = false) {
    if (!this.isOpen) return;
    const query = this.findInput.value;

    if (this.opts.isSourceMode()) {
      this.computeSourceMatches(query);
      if (this.sourceMatches.length === 0) {
        this.activeIndex = 0;
        this.countEl.textContent = '0/0';
        return;
      }
      this.activeIndex = ((this.activeIndex % this.sourceMatches.length) + this.sourceMatches.length) % this.sourceMatches.length;
      this.countEl.textContent = `${this.activeIndex + 1}/${this.sourceMatches.length}`;
      if (scrollToActive) {
        this.scrollSourceMatch(this.sourceMatches[this.activeIndex]);
      }
      return;
    }

    const tr = this.opts.editor.state.tr.setMeta(searchPluginKey, {
      query,
      caseSensitive: this.caseSensitive,
      activeIndex: this.activeIndex,
    });
    this.opts.editor.view.dispatch(tr);

    const pluginState = searchPluginKey.getState(this.opts.editor.state);
    const matches = pluginState?.matches ?? [];
    if (matches.length === 0) {
      this.activeIndex = 0;
      this.countEl.textContent = '0/0';
      return;
    }
    this.activeIndex = pluginState?.activeIndex ?? 0;
    this.countEl.textContent = `${this.activeIndex + 1}/${matches.length}`;

    if (scrollToActive) {
      this.scrollRichMatch(matches[this.activeIndex]);
    }
  }

  next() {
    this.activeIndex += 1;
    this.refresh(true);
  }

  prev() {
    this.activeIndex -= 1;
    this.refresh(true);
  }

  replaceOne() {
    const query = this.findInput.value;
    if (!query) return;
    const replacement = this.replaceInput.value;

    if (this.opts.isSourceMode()) {
      this.computeSourceMatches(query);
      if (this.sourceMatches.length === 0) return;
      const idx = ((this.activeIndex % this.sourceMatches.length) + this.sourceMatches.length) % this.sourceMatches.length;
      const match = this.sourceMatches[idx];
      const val = this.opts.sourceEditorEl.value;
      this.opts.sourceEditorEl.value = val.slice(0, match.start) + replacement + val.slice(match.end);
      this.opts.onSourceMutated();
      this.refresh(true);
      return;
    }

    const pluginState = searchPluginKey.getState(this.opts.editor.state);
    const matches = pluginState?.matches ?? [];
    if (matches.length === 0) return;
    const match = matches[pluginState?.activeIndex ?? 0];
    if (!match) return;

    const tr = this.opts.editor.state.tr.insertText(replacement, match.from, match.to);
    this.opts.editor.view.dispatch(tr);
    this.refresh(true);
  }

  replaceAll() {
    const query = this.findInput.value;
    if (!query) return;
    const replacement = this.replaceInput.value;

    if (this.opts.isSourceMode()) {
      this.computeSourceMatches(query);
      if (this.sourceMatches.length === 0) return;
      const count = this.sourceMatches.length;
      let val = this.opts.sourceEditorEl.value;
      for (let i = this.sourceMatches.length - 1; i >= 0; i--) {
        const m = this.sourceMatches[i];
        val = val.slice(0, m.start) + replacement + val.slice(m.end);
      }
      this.opts.sourceEditorEl.value = val;
      this.opts.onSourceMutated();
      this.activeIndex = 0;
      this.refresh(false);
      this.opts.showToast(`${count}건 바꿈`);
      return;
    }

    const pluginState = searchPluginKey.getState(this.opts.editor.state);
    const matches = pluginState?.matches ?? [];
    if (matches.length === 0) return;
    const count = matches.length;

    const tr = this.opts.editor.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      tr.insertText(replacement, m.from, m.to);
    }
    this.opts.editor.view.dispatch(tr);
    this.activeIndex = 0;
    this.refresh(false);
    this.opts.showToast(`${count}건 바꿈`);
  }

  private computeSourceMatches(query: string) {
    this.sourceMatches = [];
    if (!query) return;
    const text = this.opts.sourceEditorEl.value;
    const hay = this.caseSensitive ? text : text.toLowerCase();
    const needle = this.caseSensitive ? query : query.toLowerCase();
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      this.sourceMatches.push({ start: idx, end: idx + needle.length });
      idx = hay.indexOf(needle, idx + Math.max(1, needle.length));
    }
  }

  private scrollSourceMatch(match: { start: number; end: number }) {
    const el = this.opts.sourceEditorEl;
    el.setSelectionRange(match.start, match.end);
    // Approximate line scroll in textarea
    const before = el.value.slice(0, match.start);
    const lineNum = before.split('\n').length;
    const approxY = Math.max(0, lineNum * 23 - 180);
    const scrollParent = document.getElementById('editor-scroll');
    if (scrollParent) {
      scrollParent.scrollTop = approxY;
    }
  }

  private scrollRichMatch(match: SearchMatch) {
    try {
      const domAt = this.opts.editor.view.domAtPos(match.from);
      const el =
        domAt.node.nodeType === Node.ELEMENT_NODE
          ? (domAt.node as HTMLElement)
          : domAt.node.parentElement;
      const currentSpan = document.querySelector('.emdi-search-match.current') as HTMLElement | null;
      (currentSpan ?? el)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // Ignore if node detached
    }
  }
}
