import type { AppSettingsPayload, UpdateStatePayload } from '../types';
import { ACCENT_PRESETS, THEME_PALETTES, resolveThemeId } from './themes';

export interface SettingsModalOptions {
  getSettings: () => AppSettingsPayload;
  getUpdateState: () => UpdateStatePayload | null;
  onThemeChange: (themeId: string, accentId: string) => void;
  onFontSizeChange: (size: number) => void;
  onWidthModeChange: (narrow: boolean) => void;
  onAutoSaveChange: (enabled: boolean) => void;
  onPickVaultFolder: () => void;
  onClearVaultFolder: () => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onOpenReleaseNotesExternal: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSimpleChangelogMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  const formatInline = (raw: string) => {
    let s = escapeHtml(raw);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return s;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    if (trimmed.startsWith('## ')) {
      closeList();
      out.push(`<h3 class="rn-ver">${formatInline(trimmed.slice(3))}</h3>`);
    } else if (trimmed.startsWith('### ')) {
      closeList();
      out.push(`<h4 class="rn-sec">${formatInline(trimmed.slice(4))}</h4>`);
    } else if (trimmed.startsWith('# ')) {
      closeList();
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        out.push('<ul class="rn-list">');
        inList = true;
      }
      out.push(`<li>${formatInline(trimmed.slice(2))}</li>`);
    } else {
      closeList();
      out.push(`<p class="rn-p">${formatInline(trimmed)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

export class SettingsModalController {
  private readonly opts: SettingsModalOptions;

  private readonly backdrop = document.getElementById('settings-backdrop') as HTMLDivElement;
  private readonly closeBtn = document.getElementById('btn-settings-close') as HTMLButtonElement;
  private readonly tabAppearance = document.getElementById('settings-tab-appearance') as HTMLButtonElement;
  private readonly tabShortcuts = document.getElementById('settings-tab-shortcuts') as HTMLButtonElement;
  private readonly tabReleases = document.getElementById('settings-tab-releases') as HTMLButtonElement;
  private readonly paneAppearance = document.getElementById('settings-pane-appearance') as HTMLDivElement;
  private readonly paneShortcuts = document.getElementById('settings-pane-shortcuts') as HTMLDivElement;
  private readonly paneReleases = document.getElementById('settings-pane-releases') as HTMLDivElement;
  private readonly shortcutsBody = document.getElementById('settings-shortcuts-body') as HTMLDivElement;

  private readonly themeGrid = document.getElementById('settings-theme-grid') as HTMLDivElement;
  private readonly accentRow = document.getElementById('settings-accent-row') as HTMLDivElement;
  private readonly fontRange = document.getElementById('settings-font-range') as HTMLInputElement;
  private readonly fontVal = document.getElementById('settings-font-val') as HTMLSpanElement;
  private readonly widthToggle = document.getElementById('settings-width-toggle') as HTMLInputElement;
  private readonly autoSaveToggle = document.getElementById('settings-autosave-toggle') as HTMLInputElement;
  private readonly vaultPathEl = document.getElementById('settings-vault-path') as HTMLSpanElement;
  private readonly btnPickVault = document.getElementById('btn-settings-pick-vault') as HTMLButtonElement;
  private readonly btnClearVault = document.getElementById('btn-settings-clear-vault') as HTMLButtonElement;

  private readonly rnVersionBadge = document.getElementById('rn-version-badge') as HTMLSpanElement;
  private readonly rnUpdateStatus = document.getElementById('rn-update-status') as HTMLSpanElement;
  private readonly btnRnCheck = document.getElementById('btn-rn-check') as HTMLButtonElement;
  private readonly btnRnInstall = document.getElementById('btn-rn-install') as HTMLButtonElement;
  private readonly btnRnGithub = document.getElementById('btn-rn-github') as HTMLButtonElement;
  private readonly rnBody = document.getElementById('rn-changelog-body') as HTMLDivElement;

  private activeTab: 'appearance' | 'shortcuts' | 'releases' = 'appearance';
  private bundledChangelog = '';

  constructor(opts: SettingsModalOptions) {
    this.opts = opts;
    this.buildThemeCards();
    this.buildAccentSwatches();
    this.buildShortcutsGuide();
    this.bindEvents();
  }

  get isVisible(): boolean {
    return !this.backdrop.classList.contains('hidden');
  }

  setChangelog(markdown: string) {
    this.bundledChangelog = markdown;
    if (this.isVisible) {
      this.renderReleasesPane();
    }
  }

  open(initialTab: 'appearance' | 'shortcuts' | 'releases' = 'appearance') {
    this.activeTab = initialTab;
    this.backdrop.classList.remove('hidden');
    this.syncUI();
  }

  close() {
    if (this.backdrop.classList.contains('hidden')) return;
    this.backdrop.classList.add('hidden');
  }

  syncUI() {
    const s = this.opts.getSettings();
    this.tabAppearance.classList.toggle('active', this.activeTab === 'appearance');
    this.tabShortcuts.classList.toggle('active', this.activeTab === 'shortcuts');
    this.tabReleases.classList.toggle('active', this.activeTab === 'releases');
    this.paneAppearance.classList.toggle('hidden', this.activeTab !== 'appearance');
    this.paneShortcuts.classList.toggle('hidden', this.activeTab !== 'shortcuts');
    this.paneReleases.classList.toggle('hidden', this.activeTab !== 'releases');

    const activeThemeId = resolveThemeId(s.themeId);
    this.themeGrid.querySelectorAll<HTMLButtonElement>('.theme-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.themeId === activeThemeId);
    });
    this.accentRow.querySelectorAll<HTMLButtonElement>('.accent-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.accentId === s.accentId);
    });

    this.fontRange.value = String(s.fontSize);
    this.fontVal.textContent = `${s.fontSize}px`;
    this.widthToggle.checked = s.narrowWidth;
    this.autoSaveToggle.checked = s.autoSave;
    this.vaultPathEl.textContent = s.defaultVaultPath || '자동 탐지 (열린 파일 기준 .obsidian 탐색)';
    this.vaultPathEl.title = s.defaultVaultPath || '';
    this.btnClearVault.classList.toggle('hidden', !s.defaultVaultPath);

    this.renderReleasesPane();
  }

  private renderReleasesPane() {
    const upd = this.opts.getUpdateState();
    const curVer = upd?.currentVersion || '2.5.0';
    this.rnVersionBadge.textContent = `v${curVer}`;

    if (upd?.hasUpdate && upd.latestVersion) {
      this.rnUpdateStatus.textContent = `새 버전 v${upd.latestVersion} 사용 가능`;
      this.rnUpdateStatus.className = 'rn-status available';
      this.btnRnInstall.classList.remove('hidden');
      this.btnRnInstall.textContent = `v${upd.latestVersion} 지금 업데이트`;
    } else if (upd?.status === 'checking') {
      this.rnUpdateStatus.textContent = '최신 버전 확인 중...';
      this.rnUpdateStatus.className = 'rn-status';
      this.btnRnInstall.classList.add('hidden');
    } else {
      this.rnUpdateStatus.textContent = '최신 버전 사용 중';
      this.rnUpdateStatus.className = 'rn-status ok';
      this.btnRnInstall.classList.add('hidden');
    }

    if (this.bundledChangelog.trim()) {
      this.rnBody.innerHTML = renderSimpleChangelogMarkdown(this.bundledChangelog);
    } else {
      this.rnBody.innerHTML = '<p class="rn-p">릴리즈 노트 정보를 불러오는 중입니다.</p>';
    }
  }

  private buildThemeCards() {
    this.themeGrid.innerHTML = '';
    for (const theme of THEME_PALETTES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card';
      card.dataset.themeId = theme.id;

      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.innerHTML = `
        <span class="ts-side" style="background:${theme.preview[0]}"></span>
        <span class="ts-main" style="background:${theme.preview[1]}">
          <span class="ts-bar" style="background:${theme.preview[2]}"></span>
          <span class="ts-line" style="background:${theme.mode === 'light' ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.18)'}"></span>
          <span class="ts-line short" style="background:${theme.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}"></span>
        </span>
      `;

      const meta = document.createElement('span');
      meta.className = 'theme-meta';
      const title = document.createElement('span');
      title.className = 'theme-name';
      title.textContent = theme.name;
      const desc = document.createElement('span');
      desc.className = 'theme-desc';
      desc.textContent = theme.desc;
      meta.appendChild(title);
      meta.appendChild(desc);

      card.appendChild(swatch);
      card.appendChild(meta);

      card.addEventListener('click', () => {
        const cur = this.opts.getSettings();
        this.opts.onThemeChange(theme.id, cur.accentId);
        this.syncUI();
      });

      this.themeGrid.appendChild(card);
    }
  }

  private buildAccentSwatches() {
    this.accentRow.innerHTML = '';
    for (const preset of ACCENT_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'accent-dot';
      btn.dataset.accentId = preset.id;
      btn.title = preset.name;
      btn.innerHTML = `<span class="accent-dot-fill" style="background:${preset.swatch}"></span><span class="accent-dot-label">${preset.name}</span>`;
      btn.addEventListener('click', () => {
        const cur = this.opts.getSettings();
        this.opts.onThemeChange(cur.themeId, preset.id);
        this.syncUI();
      });
      this.accentRow.appendChild(btn);
    }
  }

  private buildShortcutsGuide() {
    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    const mod = isMac ? '⌘' : 'Ctrl+';
    const alt = isMac ? '⌥' : 'Alt+';
    const shift = isMac ? '⇧' : 'Shift+';

    const groups: { title: string; items: [string, string][] }[] = [
      {
        title: '파일 및 탐색',
        items: [
          ['파일 열기', `${mod}O`],
          ['폴더 열기', `${mod}${alt}O`],
          ['빠른 파일 열기', `${mod}K`],
          ['커맨드 팔레트', `${mod}${shift}P`],
          ['저장 / 다른 이름으로 저장', `${mod}S / ${mod}${shift}S`],
          ['새로고침', `${mod}R`],
          ['설정 및 테마', `${mod},`],
        ],
      },
      {
        title: '화면 및 레이아웃',
        items: [
          ['좌측 사이드바 토글', `${mod}B / ${mod}\\`],
          ['파일 탐색기 / 문서 목차', `${mod}E / ${mod}${shift}O`],
          ['현재 파일 위치 보기', `${mod}${shift}L`],
          ['집중 모드 (사이드바 숨김)', `${mod}${shift}F`],
          ['원문 마크다운 / 미리보기 전환', `${mod}/`],
          ['글자 확대 / 축소 / 초기화', `${mod}+ / ${mod}- / ${mod}0`],
        ],
      },
      {
        title: '탭 및 이동',
        items: [
          ['새 탭 / 탭 닫기', `${mod}T / ${mod}W`],
          ['닫은 탭 다시 열기', `${mod}${shift}T`],
          ['탭 번호로 바로 이동', `${mod}1~9`],
          ['탭 히스토리 뒤로 / 앞으로', `${mod}[ / ${mod}]`],
          ['링크 · 위키링크 열기', `${isMac ? '⌘' : 'Ctrl'}+클릭`],
        ],
      },
      {
        title: '주기 노트 (Obsidian 연동)',
        items: [
          ['오늘 일간 / 주간 / 월간 / 연간 노트', `${alt}1 / 2 / 3 / 4`],
          ['이전 / 다음 주기 노트 이동', `${mod}${alt}← / →`],
        ],
      },
      {
        title: '편집 및 찾기',
        items: [
          ['슬래시 블록 메뉴', '빈 줄에서 /'],
          ['찾기 / 찾기 및 바꾸기', `${mod}F / ${mod}${alt}F`],
          ['체크박스 토글', `${mod}Enter`],
          ['줄 · 목록 위/아래 이동', `${alt}↑ / ↓`],
          ['굵게 / 형광펜 / 링크 삽입', `${mod}${shift}B / H / K`],
          ['PDF 내보내기 / 인쇄', `${mod}${shift}E / ${mod}P`],
        ],
      },
    ];

    this.shortcutsBody.innerHTML = groups
      .map(
        (g) => `
        <div class="shortcut-group">
          <div class="shortcut-group-title">${escapeHtml(g.title)}</div>
          <div class="shortcut-list">
            ${g.items
              .map(
                ([label, keys]) => `
                <div class="shortcut-row">
                  <span class="shortcut-label">${escapeHtml(label)}</span>
                  <kbd class="shortcut-kbd">${escapeHtml(keys)}</kbd>
                </div>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('');
  }

  private bindEvents() {
    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop) this.close();
    });
    this.closeBtn.addEventListener('click', () => this.close());
    this.tabAppearance.addEventListener('click', () => {
      this.activeTab = 'appearance';
      this.syncUI();
    });
    this.tabShortcuts.addEventListener('click', () => {
      this.activeTab = 'shortcuts';
      this.syncUI();
    });
    this.tabReleases.addEventListener('click', () => {
      this.activeTab = 'releases';
      this.syncUI();
    });
    this.fontRange.addEventListener('input', () => {
      const size = Number(this.fontRange.value);
      this.fontVal.textContent = `${size}px`;
      this.opts.onFontSizeChange(size);
    });
    this.widthToggle.addEventListener('change', () => {
      this.opts.onWidthModeChange(this.widthToggle.checked);
    });
    this.autoSaveToggle.addEventListener('change', () => {
      this.opts.onAutoSaveChange(this.autoSaveToggle.checked);
    });
    this.btnPickVault.addEventListener('click', () => this.opts.onPickVaultFolder());
    this.btnClearVault.addEventListener('click', () => this.opts.onClearVaultFolder());
    this.btnRnCheck.addEventListener('click', () => this.opts.onCheckUpdates());
    this.btnRnInstall.addEventListener('click', () => {
      this.close();
      this.opts.onInstallUpdate();
    });
    this.btnRnGithub.addEventListener('click', () => this.opts.onOpenReleaseNotesExternal());
  }
}
