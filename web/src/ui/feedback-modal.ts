export interface FeedbackModalOptions {
  getAppVersion: () => string;
  getOsInfo: () => string;
  onOpenExternal: (url: string) => void;
  showToast: (message: string, duration?: number) => void;
}

const GITHUB_NEW_ISSUE_BASE = 'https://github.com/SheepCastle/emdi/issues/new';
const FEEDBACK_EMAIL = 'dladidtjd@gmail.com';

export function buildBugReportUrl(version: string, os: string): string {
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    labels: 'bug,user-feedback',
    version,
    os,
  });
  return `${GITHUB_NEW_ISSUE_BASE}?${params.toString()}`;
}

export function buildFeatureRequestUrl(version: string, os: string): string {
  const params = new URLSearchParams({
    template: 'feature_request.yml',
    labels: 'enhancement,user-feedback',
    version,
    os,
  });
  return `${GITHUB_NEW_ISSUE_BASE}?${params.toString()}`;
}

export function buildFeedbackMailtoUrl(version: string, os: string): string {
  const versionLabel = version ? `v${version}` : 'unknown';
  const subject = `[emdi ${versionLabel} 피드백]`;
  const body = [
    `- 앱 버전: ${versionLabel}`,
    `- 운영체제: ${os}`,
    '',
    '[유형] 버그 제보 / 기능 제안',
    '',
    '[내용]',
    '(증상 또는 제안 내용을 자유롭게 작성해 주세요)',
    '',
    '[재현 단계 (버그인 경우)]',
    '1. ',
    '2. ',
  ].join('\n');

  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export class FeedbackModalController {
  private readonly opts: FeedbackModalOptions;

  private readonly backdrop = document.getElementById('feedback-backdrop') as HTMLDivElement;
  private readonly closeBtn = document.getElementById('btn-feedback-close') as HTMLButtonElement;
  private readonly envBadge = document.getElementById('feedback-env-badge') as HTMLSpanElement;
  private readonly btnBug = document.getElementById('btn-feedback-bug') as HTMLButtonElement;
  private readonly btnFeature = document.getElementById('btn-feedback-feature') as HTMLButtonElement;
  private readonly btnEmail = document.getElementById('btn-feedback-email') as HTMLButtonElement;

  constructor(opts: FeedbackModalOptions) {
    this.opts = opts;
    this.bindEvents();
  }

  get isVisible(): boolean {
    return !this.backdrop.classList.contains('hidden');
  }

  open() {
    this.syncEnvBadge();
    this.backdrop.classList.remove('hidden');
  }

  close() {
    if (this.backdrop.classList.contains('hidden')) return;
    this.backdrop.classList.add('hidden');
  }

  private syncEnvBadge() {
    const version = this.opts.getAppVersion();
    const os = this.opts.getOsInfo();
    const parts: string[] = [];
    if (version) parts.push(`v${version}`);
    if (os) parts.push(os);
    this.envBadge.textContent = parts.join(' · ');
  }

  private bindEvents() {
    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop) this.close();
    });
    this.closeBtn.addEventListener('click', () => this.close());

    this.btnBug.addEventListener('click', () => {
      const url = buildBugReportUrl(this.opts.getAppVersion(), this.opts.getOsInfo());
      this.close();
      this.opts.onOpenExternal(url);
      this.opts.showToast('브라우저에서 버그 제보 페이지를 열었습니다', 2200);
    });

    this.btnFeature.addEventListener('click', () => {
      const url = buildFeatureRequestUrl(this.opts.getAppVersion(), this.opts.getOsInfo());
      this.close();
      this.opts.onOpenExternal(url);
      this.opts.showToast('브라우저에서 기능 제안 페이지를 열었습니다', 2200);
    });

    this.btnEmail.addEventListener('click', () => {
      const url = buildFeedbackMailtoUrl(this.opts.getAppVersion(), this.opts.getOsInfo());
      this.close();
      this.opts.onOpenExternal(url);
      this.opts.showToast('기본 메일 앱을 열었습니다', 2200);
    });
  }
}
