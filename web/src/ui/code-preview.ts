import { common, createLowlight } from 'lowlight';
import { escapeHtmlText } from '../markdown-preprocess';

const lowlight = createLowlight(common);

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonl: 'json',
  canvas: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  plist: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  diff: 'diff',
  patch: 'diff',
  ini: 'ini',
  toml: 'ini',
  conf: 'ini',
  env: 'bash',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

function hastToHtml(nodes: HastNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += escapeHtmlText(node.value ?? '');
    } else if (node.type === 'element' && node.tagName) {
      const cls = node.properties?.className?.join(' ');
      const open = cls ? `<${node.tagName} class="${cls}">` : `<${node.tagName}>`;
      const inner = node.children ? hastToHtml(node.children) : '';
      out += `${open}${inner}</${node.tagName}>`;
    }
  }
  return out;
}

function parseDelimitedTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (ch !== '\r') {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

export function renderCodeOrDataPreview(
  container: HTMLElement,
  content: string,
  ext: string,
  onCopy: (text: string) => void
) {
  const normalizedExt = ext.toLowerCase();
  container.innerHTML = '';

  // CSV / TSV table preview
  if (normalizedExt === 'csv' || normalizedExt === 'tsv') {
    const delimiter = normalizedExt === 'tsv' ? '\t' : ',';
    const rows = parseDelimitedTable(content, delimiter);
    if (rows.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'data-table-wrap';
      const headerBar = document.createElement('div');
      headerBar.className = 'code-preview-header';
      headerBar.innerHTML = `<span class="code-preview-lang">${normalizedExt.toUpperCase()} 표 (${rows.length.toLocaleString()}행)</span>`;

      const tableScroll = document.createElement('div');
      tableScroll.className = 'data-table-scroll';
      const table = document.createElement('table');
      table.className = 'data-table';

      const maxCols = Math.max(...rows.slice(0, 500).map((r) => r.length));
      const thead = document.createElement('thead');
      const headTr = document.createElement('tr');
      for (let c = 0; c < maxCols; c++) {
        const th = document.createElement('th');
        th.textContent = rows[0][c] ?? '';
        headTr.appendChild(th);
      }
      thead.appendChild(headTr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      const limit = Math.min(rows.length, 600);
      for (let r = 1; r < limit; r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < maxCols; c++) {
          const td = document.createElement('td');
          td.textContent = rows[r][c] ?? '';
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableScroll.appendChild(table);
      wrap.appendChild(headerBar);
      wrap.appendChild(tableScroll);
      if (rows.length > limit) {
        const note = document.createElement('div');
        note.className = 'code-preview-note';
        note.textContent = `상위 ${limit}행까지 표시했습니다. 전체 편집은 우측 상단 "편집" 버튼을 눌러 주세요.`;
        wrap.appendChild(note);
      }
      container.appendChild(wrap);
      return;
    }
  }

  // Highlighted code / text card
  const lang = EXT_TO_LANG[normalizedExt] ?? '';
  let highlightedHtml = '';
  if (lang && lowlight.registered(lang) && content.length <= 350_000) {
    try {
      const tree = lowlight.highlight(lang, content);
      highlightedHtml = hastToHtml(tree.children as HastNode[]);
    } catch {
      highlightedHtml = escapeHtmlText(content);
    }
  } else {
    highlightedHtml = escapeHtmlText(content);
  }

  const lines = content.split(/\r?\n/);
  const card = document.createElement('div');
  card.className = 'code-preview-card';

  const header = document.createElement('div');
  header.className = 'code-preview-header';

  const langLabel = document.createElement('span');
  langLabel.className = 'code-preview-lang';
  langLabel.textContent = `${(lang || normalizedExt || 'TEXT').toUpperCase()} · ${lines.length.toLocaleString()}줄`;

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'emdi-code-btn';
  copyBtn.textContent = '전체 복사';
  copyBtn.addEventListener('click', () => {
    onCopy(content);
    copyBtn.textContent = '복사됨';
    copyBtn.classList.add('copied');
    window.setTimeout(() => {
      copyBtn.textContent = '전체 복사';
      copyBtn.classList.remove('copied');
    }, 1500);
  });

  header.appendChild(langLabel);
  header.appendChild(copyBtn);

  const body = document.createElement('div');
  body.className = 'code-preview-body';

  const gutter = document.createElement('div');
  gutter.className = 'code-preview-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  gutter.textContent = lines.map((_, i) => String(i + 1)).join('\n');

  const pre = document.createElement('pre');
  pre.className = 'code-preview-pre';
  const code = document.createElement('code');
  code.innerHTML = highlightedHtml || '\n';
  pre.appendChild(code);

  body.appendChild(gutter);
  body.appendChild(pre);
  card.appendChild(header);
  card.appendChild(body);
  container.appendChild(card);
}
