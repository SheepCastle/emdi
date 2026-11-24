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

export function buildFeedbackEmailDraft(version: string, os: string): { subject: string; body: string } {
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
  return { subject, body };
}

export function buildFeedbackGmailUrl(version: string, os: string): string {
  const { subject, body } = buildFeedbackEmailDraft(version, os);
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: FEEDBACK_EMAIL,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function buildFeedbackMailtoUrl(version: string, os: string): string {
  const { subject, body } = buildFeedbackEmailDraft(version, os);
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export class FeedbackModalController {
  private readonly opts: FeedbackModalOptions;

  private readonly backdrop = document.getElementById('feedback-backdrop') as HTMLDivElement;
  private readonly closeBtn = document.getElementById('btn-feedback-close') as HTMLButtonElement;
  private readonly envBadge = document.getElementById('feedback-env-badge') as HTMLSpanElement;
  private readonly btnBug = document.getElementById('btn-feedback-bug') as HTMLButtonElement;
  private readonly btnFeature = document.getElementById('btn-feedback-feature') as HTMLButtonElement;
  private readonly btnEmail = document.getElementById('btn-feedback-email') as HTMLButtonElement;
  private readonly btnMailto = document.getElementById('btn-feedback-mailto') as HTMLButtonElement;
  private readonly btnCopyEmail = document.getElementById('btn-feedback-copy-email') as HTMLButtonElement;
  private readonly btnCopyTemplate = document.getElementById('btn-feedback-copy-template') as HTMLButtonElement;

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
      const url = buildFeedbackGmailUrl(this.opts.getAppVersion(), this.opts.getOsInfo());
      this.close();
      this.opts.onOpenExternal(url);
      this.opts.showToast('브라우저에서 Gmail 작성창을 열었습니다', 2200);
    });

    this.btnMailto.addEventListener('click', () => {
      const url = buildFeedbackMailtoUrl(this.opts.getAppVersion(), this.opts.getOsInfo());
      this.close();
      this.opts.onOpenExternal(url);
      this.opts.showToast('기본 메일 앱을 열었습니다', 2200);
    });

    this.btnCopyEmail.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(FEEDBACK_EMAIL);
      this.opts.showToast(
        ok ? `이메일 주소를 복사했습니다 (${FEEDBACK_EMAIL})` : '클립보드 복사에 실패했습니다',
        2200,
      );
    });

    this.btnCopyTemplate.addEventListener('click', async () => {
      const { subject, body } = buildFeedbackEmailDraft(this.opts.getAppVersion(), this.opts.getOsInfo());
      const fullText = `받는 사람: ${FEEDBACK_EMAIL}\n제목: ${subject}\n\n${body}`;
      const ok = await copyTextToClipboard(fullText);
      this.opts.showToast(
        ok ? '피드백 이메일 양식을 복사했습니다' : '클립보드 복사에 실패했습니다',
        2200,
      );
    });
  }
}
