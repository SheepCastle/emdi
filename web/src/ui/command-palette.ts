export interface CommandItem {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  keywords: string[];
  run: () => void;
}

export class CommandPaletteController {
  private readonly backdrop = document.getElementById('cmd-palette-backdrop') as HTMLDivElement;
  private readonly input = document.getElementById('cmd-palette-input') as HTMLInputElement;
  private readonly listEl = document.getElementById('cmd-palette-list') as HTMLDivElement;

  private readonly getCommands: () => CommandItem[];
  private filtered: CommandItem[] = [];
  private activeIndex = 0;

  constructor(opts: { getCommands: () => CommandItem[] }) {
    this.getCommands = opts.getCommands;
    this.bindEvents();
  }

  get isVisible(): boolean {
    return !this.backdrop.classList.contains('hidden');
  }

  open() {
    this.backdrop.classList.remove('hidden');
    this.input.value = '';
    this.activeIndex = 0;
    this.filter('');
    this.input.focus();
  }

  close() {
    if (this.backdrop.classList.contains('hidden')) return;
    this.backdrop.classList.add('hidden');
  }

  private filter(rawQuery: string) {
    const q = rawQuery.trim().toLowerCase();
    const all = this.getCommands();
    if (!q) {
      this.filtered = all;
    } else {
      const terms = q.split(/\s+/).filter(Boolean);
      this.filtered = all.filter((cmd) => {
        const hay = `${cmd.title} ${cmd.category} ${cmd.shortcut ?? ''} ${cmd.keywords.join(' ')}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    this.activeIndex = 0;
    this.render();
  }

  private render() {
    this.listEl.innerHTML = '';
    if (this.filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quick-open-empty';
      empty.textContent = '일치하는 명령이 없습니다.';
      this.listEl.appendChild(empty);
      return;
    }

    this.filtered.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = idx === this.activeIndex ? 'quick-open-item cmd-palette-item active' : 'quick-open-item cmd-palette-item';

      const catEl = document.createElement('span');
      catEl.className = 'cmd-palette-cat';
      catEl.textContent = item.category;

      const titleEl = document.createElement('span');
      titleEl.className = 'cmd-palette-title';
      titleEl.textContent = item.title;

      btn.appendChild(catEl);
      btn.appendChild(titleEl);

      if (item.shortcut) {
        const kbdEl = document.createElement('kbd');
        kbdEl.className = 'cmd-palette-kbd';
        kbdEl.textContent = item.shortcut;
        btn.appendChild(kbdEl);
      }

      btn.addEventListener('mouseenter', () => {
        this.activeIndex = idx;
        this.listEl.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
          el.classList.toggle('active', i === idx);
        });
      });

      btn.addEventListener('click', () => {
        this.close();
        item.run();
      });

      this.listEl.appendChild(btn);
    });

    const activeEl = this.listEl.querySelector('.cmd-palette-item.active') as HTMLElement | null;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }

  private bindEvents() {
    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop) this.close();
    });

    this.input.addEventListener('input', () => {
      this.filter(this.input.value);
    });

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (this.filtered.length > 0) {
          this.activeIndex = (this.activeIndex + 1) % this.filtered.length;
          this.render();
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.filtered.length > 0) {
          this.activeIndex = (this.activeIndex - 1 + this.filtered.length) % this.filtered.length;
          this.render();
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = this.filtered[this.activeIndex];
        if (selected) {
          this.close();
          selected.run();
        }
      }
    });
  }
}
