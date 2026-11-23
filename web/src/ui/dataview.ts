import type { DataviewNoteRecord, DataviewResultPayload } from '../types';

interface DataviewColumn {
  expr: string;
  label: string;
}

interface DataviewWhereClause {
  op: '=' | '!=' | 'contains';
  field: string;
  value: string;
}

interface ParsedDataviewQuery {
  kind: 'table' | 'list';
  withoutId: boolean;
  columns: DataviewColumn[];
  listExpr: string;
  fromFolder: string;
  fromTag: string;
  wheres: DataviewWhereClause[];
  sortField: string;
  sortDir: 'asc' | 'desc';
  limit: number | null;
}

let postNativeFn: (payload: Record<string, unknown>) => void = () => {};
let getActiveTabIdFn: () => string = () => '';
let reqSeq = 0;

const pendingRequests = new Map<
  string,
  { resolve: (items: DataviewNoteRecord[]) => void; reject: (err: Error) => void }
>();

export function configureDataviewBridge(opts: {
  postNative: (payload: Record<string, unknown>) => void;
  getActiveTabId: () => string;
}) {
  postNativeFn = opts.postNative;
  getActiveTabIdFn = opts.getActiveTabId;
}

export function handleDataviewResult(payload: DataviewResultPayload) {
  const entry = pendingRequests.get(payload.requestId);
  if (!entry) return;
  pendingRequests.delete(payload.requestId);
  if (payload.error) {
    entry.reject(new Error(payload.error));
  } else {
    entry.resolve(payload.items || []);
  }
}

function queryFolderNotes(fromFolder: string): Promise<DataviewNoteRecord[]> {
  const requestId = `dv-${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Dataview 조회 시간이 초과되었습니다'));
      }
    }, 6000);

    pendingRequests.set(requestId, {
      resolve: (items) => {
        window.clearTimeout(timer);
        resolve(items);
      },
      reject: (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    });

    postNativeFn({
      type: 'queryDataviewFolder',
      requestId,
      from: fromFolder,
      tabId: getActiveTabIdFn(),
    });
  });
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function splitTopLevelCommas(str: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote: string | null = null;
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseDataviewQuery(source: string): ParsedDataviewQuery | null {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));
  if (lines.length === 0) return null;

  const first = lines[0];
  let kind: 'table' | 'list';
  let withoutId = false;
  let columns: DataviewColumn[] = [];
  let listExpr = '';

  const tableMatch = first.match(/^TABLE(?:\s+WITHOUT\s+ID)?\b(.*)$/i);
  const listMatch = first.match(/^LIST(?:\s+WITHOUT\s+ID)?\b(.*)$/i);

  if (tableMatch) {
    kind = 'table';
    withoutId = /^TABLE\s+WITHOUT\s+ID\b/i.test(first);
    const colsRaw = tableMatch[1].trim();
    if (colsRaw) {
      for (const part of splitTopLevelCommas(colsRaw)) {
        const asMatch = part.match(/^(.+?)\s+AS\s+(.+)$/i);
        if (asMatch) {
          columns.push({ expr: asMatch[1].trim(), label: unquote(asMatch[2]) });
        } else {
          columns.push({ expr: part.trim(), label: part.trim() });
        }
      }
    }
    if (!withoutId) {
      columns.unshift({ expr: 'file.link', label: 'File' });
    }
  } else if (listMatch) {
    kind = 'list';
    listExpr = listMatch[1].trim();
  } else {
    return null;
  }

  let fromFolder = '';
  let fromTag = '';
  const wheres: DataviewWhereClause[] = [];
  let sortField = '';
  let sortDir: 'asc' | 'desc' = 'asc';
  let limit: number | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    const fromMatch = line.match(/^FROM\s+(.+)$/i);
    if (fromMatch) {
      const target = fromMatch[1].trim();
      if (target.startsWith('#')) {
        fromTag = target.slice(1).trim();
      } else {
        fromFolder = unquote(target);
      }
      continue;
    }

    const whereMatch = line.match(/^WHERE\s+(.+)$/i);
    if (whereMatch) {
      const rawExpr = whereMatch[1].trim();
      const subParts = rawExpr.split(/\s+AND\s+/i);
      for (const sub of subParts) {
        const containsM = sub.match(/^contains\(\s*([^,]+)\s*,\s*(.+?)\s*\)$/i);
        if (containsM) {
          wheres.push({ op: 'contains', field: containsM[1].trim(), value: unquote(containsM[2]) });
          continue;
        }
        const neqM = sub.match(/^([a-zA-Z0-9_.\uAC00-\uD7A3-]+)\s*!=\s*(.+)$/);
        if (neqM) {
          wheres.push({ op: '!=', field: neqM[1].trim(), value: unquote(neqM[2]) });
          continue;
        }
        const eqM = sub.match(/^([a-zA-Z0-9_.\uAC00-\uD7A3-]+)\s*=\s*(.+)$/);
        if (eqM) {
          wheres.push({ op: '=', field: eqM[1].trim(), value: unquote(eqM[2]) });
        }
      }
      continue;
    }

    const sortMatch = line.match(/^SORT\s+([^\s]+)(?:\s+(ASC|DESC))?/i);
    if (sortMatch) {
      sortField = sortMatch[1].trim();
      sortDir = (sortMatch[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc');
      continue;
    }

    const limitMatch = line.match(/^LIMIT\s+(\d+)/i);
    if (limitMatch) {
      limit = Number(limitMatch[1]);
      continue;
    }

    // Unsupported advanced clause (GROUP BY, FLATTEN, etc.)
    if (/^(GROUP\s+BY|FLATTEN)\b/i.test(line)) {
      return null;
    }
  }

  return {
    kind,
    withoutId,
    columns,
    listExpr,
    fromFolder,
    fromTag,
    wheres,
    sortField,
    sortDir,
    limit,
  };
}

function getFieldValue(note: DataviewNoteRecord, field: string): string | string[] {
  const key = field.trim();
  const low = key.toLowerCase();
  if (low === 'file.name' || low === 'file.link') return note.name;
  if (low === 'file.folder') return note.folder;
  if (low === 'file.mtime') return note.mtime;
  if (low === 'file.ctime') return note.ctime;
  if (low === 'file.path') return note.path;

  const props = note.props || {};
  if (key in props) return props[key];
  const matchedKey = Object.keys(props).find((k) => k.toLowerCase() === low);
  if (matchedKey) return props[matchedKey];
  return '';
}

function asComparableString(val: string | string[]): string {
  return Array.isArray(val) ? val.join(', ') : String(val ?? '');
}

function matchesWhere(note: DataviewNoteRecord, clause: DataviewWhereClause): boolean {
  const val = getFieldValue(note, clause.field);
  const target = clause.value.toLowerCase();
  if (clause.op === 'contains') {
    if (Array.isArray(val)) {
      return val.some((item) => item.toLowerCase().includes(target));
    }
    return String(val).toLowerCase().includes(target);
  }
  if (clause.op === '=') {
    if (Array.isArray(val)) {
      return val.some((item) => item.toLowerCase() === target);
    }
    return String(val).trim().toLowerCase() === target;
  }
  if (clause.op === '!=') {
    if (Array.isArray(val)) {
      return !val.some((item) => item.toLowerCase() === target);
    }
    return String(val).trim().toLowerCase() !== target;
  }
  return true;
}

function renderCellContent(
  td: HTMLElement,
  note: DataviewNoteRecord,
  expr: string,
  onOpenFile: (path: string) => void
) {
  const low = expr.trim().toLowerCase();
  if (low === 'file.link') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emdi-dv-link';
    btn.textContent = note.name;
    btn.title = note.path;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpenFile(note.path);
    });
    td.appendChild(btn);
    return;
  }

  const val = getFieldValue(note, expr);
  if (Array.isArray(val)) {
    if (val.length === 0) {
      td.textContent = '-';
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'emdi-dv-tags';
    for (const item of val) {
      const chip = document.createElement('span');
      chip.className = 'emdi-dv-tag';
      chip.textContent = low === 'tags' || low === 'file.tags' ? `#${item.replace(/^#/, '')}` : item;
      wrap.appendChild(chip);
    }
    td.appendChild(wrap);
    return;
  }

  const text = String(val ?? '').trim();
  td.textContent = text || '-';
}

export async function renderDataviewInto(
  container: HTMLElement,
  source: string,
  onOpenFile: (path: string) => void
): Promise<boolean> {
  const parsed = parseDataviewQuery(source);
  if (!parsed) {
    return false;
  }

  container.innerHTML = '<div class="emdi-dv-empty">Dataview 데이터를 불러오는 중...</div>';

  try {
    const rawItems = await queryFolderNotes(parsed.fromFolder);
    let filtered = rawItems.filter((note) => {
      if (parsed.fromTag) {
        const tags = getFieldValue(note, 'tags');
        const list = Array.isArray(tags) ? tags : [tags];
        const tagLower = parsed.fromTag.toLowerCase();
        if (!list.some((t) => t.replace(/^#/, '').toLowerCase() === tagLower)) {
          return false;
        }
      }
      return parsed.wheres.every((w) => matchesWhere(note, w));
    });

    if (parsed.sortField) {
      const dir = parsed.sortDir === 'desc' ? -1 : 1;
      filtered.sort((a, b) => {
        const va = asComparableString(getFieldValue(a, parsed.sortField));
        const vb = asComparableString(getFieldValue(b, parsed.sortField));
        return va.localeCompare(vb, 'ko', { numeric: true, sensitivity: 'base' }) * dir;
      });
    }

    if (parsed.limit !== null && parsed.limit >= 0) {
      filtered = filtered.slice(0, parsed.limit);
    }

    container.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'emdi-dv-empty';
      empty.textContent = '조건에 일치하는 노트가 없습니다.';
      container.appendChild(empty);
      return true;
    }

    if (parsed.kind === 'list') {
      const ul = document.createElement('ul');
      ul.className = 'emdi-dv-list';
      for (const note of filtered) {
        const li = document.createElement('li');
        renderCellContent(li, note, 'file.link', onOpenFile);
        if (parsed.listExpr && parsed.listExpr.toLowerCase() !== 'file.link') {
          const sep = document.createElement('span');
          sep.className = 'emdi-dv-list-sep';
          sep.textContent = ' · ';
          li.appendChild(sep);
          const extra = document.createElement('span');
          extra.className = 'emdi-dv-list-extra';
          renderCellContent(extra, note, parsed.listExpr, onOpenFile);
          li.appendChild(extra);
        }
        ul.appendChild(li);
      }
      container.appendChild(ul);
      return true;
    }

    const scroll = document.createElement('div');
    scroll.className = 'emdi-dv-scroll';
    const table = document.createElement('table');
    table.className = 'emdi-dv-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of parsed.columns) {
      const th = document.createElement('th');
      th.textContent = col.label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const note of filtered) {
      const tr = document.createElement('tr');
      for (const col of parsed.columns) {
        const td = document.createElement('td');
        renderCellContent(td, note, col.expr, onOpenFile);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);

    const meta = document.createElement('div');
    meta.className = 'emdi-dv-footer';
    meta.textContent = `총 ${filtered.length}개 항목`;

    container.appendChild(scroll);
    container.appendChild(meta);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Dataview 조회 실패';
    container.innerHTML = '';
    const errDiv = document.createElement('div');
    errDiv.className = 'emdi-mermaid-error';
    errDiv.textContent = msg;
    container.appendChild(errDiv);
    return true;
  }
}
