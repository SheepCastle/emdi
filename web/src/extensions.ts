import { Extension, Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { common, createLowlight } from 'lowlight';
import { renderDataviewInto } from './ui/dataview';

// ── Lazy-Loaded Mermaid (Loaded only when a mermaid block exists) ──

type MermaidAPI = (typeof import('mermaid'))['default'];
let mermaidModulePromise: Promise<MermaidAPI> | null = null;
let mermaidLastThemeMode: 'dark' | 'light' | null = null;
let currentMermaidThemeMode: 'dark' | 'light' = 'dark';
let mermaidRenderSeq = 0;

export function setMermaidThemeMode(isLight: boolean) {
  currentMermaidThemeMode = isLight ? 'light' : 'dark';
}

async function getMermaid(): Promise<MermaidAPI> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidModulePromise;
  if (mermaidLastThemeMode !== currentMermaidThemeMode) {
    mermaidLastThemeMode = currentMermaidThemeMode;
    const isLight = currentMermaidThemeMode === 'light';
    mermaid.initialize({
      startOnLoad: false,
      theme: isLight ? 'default' : 'dark',
      securityLevel: 'strict',
      fontFamily: 'Pretendard, -apple-system, BlinkMacSystemFont, sans-serif',
      themeVariables: isLight
        ? {
            darkMode: false,
            background: '#ffffff',
            primaryColor: '#eef2ff',
            primaryTextColor: '#18181b',
            primaryBorderColor: '#6366f1',
            lineColor: '#4f46e5',
            secondaryColor: '#f4f4f5',
            tertiaryColor: '#fafafa',
            noteBkgColor: '#eef2ff',
            noteTextColor: '#18181b',
            noteBorderColor: '#6366f1',
          }
        : {
            darkMode: true,
            background: '#1b1d26',
            primaryColor: '#282a36',
            primaryTextColor: '#f8f8f2',
            primaryBorderColor: '#c4b5fd',
            lineColor: '#a78bfa',
            secondaryColor: '#232532',
            tertiaryColor: '#1f2230',
            noteBkgColor: '#282a36',
            noteTextColor: '#e8e9f2',
            noteBorderColor: '#a78bfa',
          },
    });
  }
  return mermaid;
}

// ── Image Context Provider ──

let imageContextProvider: () => { tabId: string; nonce: number } = () => ({ tabId: '', nonce: 1 });
let copyFeedbackHandler: (text: string) => void = () => {};
let openFilePathHandler: (path: string) => void = () => {};

export function setExtensionProviders(opts: {
  getImageContext: () => { tabId: string; nonce: number };
  onCopyText: (text: string) => void;
  onOpenFilePath?: (path: string) => void;
}) {
  imageContextProvider = opts.getImageContext;
  copyFeedbackHandler = opts.onCopyText;
  if (opts.onOpenFilePath) {
    openFilePathHandler = opts.onOpenFilePath;
  }
}

export function isExternalOrDataSrc(src: string): boolean {
  return /^(https?:|data:|blob:|emdi-local:)/i.test(src.trim());
}

export function toViewImageSrc(rawSrc: string | null | undefined): string {
  const src = (rawSrc ?? '').trim();
  if (!src) return '';
  if (isExternalOrDataSrc(src)) return src;
  const { tabId, nonce } = imageContextProvider();
  const tabQuery = tabId ? `&tabId=${encodeURIComponent(tabId)}` : '';
  const isWindowsTauri =
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) &&
    /Win/i.test(navigator.platform || navigator.userAgent);
  const schemePrefix = isWindowsTauri ? 'http://emdi-local.localhost/file' : 'emdi-local://file';
  return `${schemePrefix}?path=${encodeURIComponent(src)}${tabQuery}&v=${nonce}`;
}

function escapeMarkdownAlt(alt: string): string {
  return alt.replace(/([[\]])/g, '\\$1');
}

function formatMarkdownImageDest(src: string): string {
  const trimmed = src.trim();
  if (/[\s()]/.test(trimmed) && !(trimmed.startsWith('<') && trimmed.endsWith('>'))) {
    return `<${trimmed}>`;
  }
  return trimmed;
}

// ── 1. EmdiImage (Local Scheme + Obsidian ![[...]] Lossless) ──

export const EmdiImage = Image.extend({
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-raw-src');
          if (raw) return raw;
          const attrSrc = element.getAttribute('src') ?? '';
          try {
            if (!isExternalOrDataSrc(attrSrc)) {
              return decodeURI(attrSrc);
            }
          } catch {
            // Keep original if decodeURI fails
          }
          return attrSrc;
        },
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('alt'),
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('title'),
      },
      wiki: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-wiki') === 'true',
      },
      wikiRaw: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-wiki-raw'),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const rawSrc = (HTMLAttributes.src as string | null) ?? '';
    const viewSrc = toViewImageSrc(rawSrc);
    const attrs: Record<string, unknown> = {
      src: viewSrc,
      'data-raw-src': rawSrc,
    };
    if (HTMLAttributes.alt) attrs.alt = HTMLAttributes.alt;
    if (HTMLAttributes.title) attrs.title = HTMLAttributes.title;
    if (HTMLAttributes.wiki) {
      attrs['data-wiki'] = 'true';
      if (HTMLAttributes.wikiRaw) attrs['data-wiki-raw'] = HTMLAttributes.wikiRaw;
    }
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const src = String(node.attrs.src ?? '');
          if (node.attrs.wiki) {
            const raw = String(node.attrs.wikiRaw || src);
            state.write(`![[${raw}]]`);
            return;
          }
          const alt = escapeMarkdownAlt(String(node.attrs.alt ?? ''));
          const dest = formatMarkdownImageDest(src);
          const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
          state.write(`![${alt}](${dest}${title})`);
        },
        parse: {},
      },
    };
  },
});

// ── 2. EmdiWikiLink (Obsidian [[target|alias]] Lossless Inline Node) ──

export const EmdiWikiLink = TiptapNode.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-wiki-raw') ?? '',
      },
      target: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-wiki-target') ?? '',
      },
      alias: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-wiki-alias') ?? '',
      },
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.textContent ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink="true"]' }];
  },

  renderHTML({ node }) {
    const target = String(node.attrs.target ?? '');
    const alias = String(node.attrs.alias ?? '');
    const raw = String(node.attrs.raw || (alias ? `${target}|${alias}` : target));
    const label = String(node.attrs.label || alias || target.replace(/\.md$/i, ''));
    return [
      'span',
      {
        class: 'emdi-wikilink',
        'data-wikilink': 'true',
        'data-wiki-raw': raw,
        'data-wiki-target': target,
        'data-wiki-alias': alias,
      },
      label,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const raw = String(node.attrs.raw || node.attrs.target || '');
          state.write(`[[${raw}]]`);
        },
        parse: {},
      },
    };
  },
});

// ── 3. EmdiHighlight (==highlighted== Lossless Mark) ──

export const EmdiHighlight = Highlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: '==',
          close: '==',
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

// ── 4. EmdiCodeBlock (Lowlight Syntax Highlighting + Copy + Language Picker + Mermaid) ──

const lowlight = createLowlight(common);

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'plain' },
  { value: 'mermaid', label: 'mermaid' },
  { value: 'typescript', label: 'typescript' },
  { value: 'javascript', label: 'javascript' },
  { value: 'python', label: 'python' },
  { value: 'swift', label: 'swift' },
  { value: 'bash', label: 'bash' },
  { value: 'json', label: 'json' },
  { value: 'yaml', label: 'yaml' },
  { value: 'markdown', label: 'markdown' },
  { value: 'html', label: 'html' },
  { value: 'css', label: 'css' },
  { value: 'sql', label: 'sql' },
  { value: 'rust', label: 'rust' },
  { value: 'go', label: 'go' },
  { value: 'java', label: 'java' },
  { value: 'cpp', label: 'cpp' },
  { value: 'c', label: 'c' },
  { value: 'xml', label: 'xml' },
  { value: 'diff', label: 'diff' },
];

export const EmdiCodeBlock = CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: null,
}).extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node;
      let showMermaidCode = false;
      let renderDebounce: number | undefined;
      let lastRenderedSource = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'emdi-codeblock';

      const header = document.createElement('div');
      header.className = 'emdi-codeblock-header';
      header.contentEditable = 'false';

      const langSelect = document.createElement('select');
      langSelect.className = 'emdi-code-lang';
      langSelect.title = '코드 언어 선택';

      const syncLanguageOptions = (lang: string) => {
        const normalized = (lang || '').toLowerCase();
        langSelect.innerHTML = '';
        let matched = false;
        for (const opt of LANGUAGE_OPTIONS) {
          const el = document.createElement('option');
          el.value = opt.value;
          el.textContent = opt.label;
          if (opt.value === normalized) {
            el.selected = true;
            matched = true;
          }
          langSelect.appendChild(el);
        }
        if (!matched && normalized) {
          const custom = document.createElement('option');
          custom.value = normalized;
          custom.textContent = normalized;
          custom.selected = true;
          langSelect.appendChild(custom);
        }
      };

      const actions = document.createElement('div');
      actions.className = 'emdi-code-actions';

      const mermaidToggleBtn = document.createElement('button');
      mermaidToggleBtn.type = 'button';
      mermaidToggleBtn.className = 'emdi-code-btn hidden';
      mermaidToggleBtn.textContent = '코드 편집';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'emdi-code-btn';
      copyBtn.textContent = '복사';

      actions.appendChild(mermaidToggleBtn);
      actions.appendChild(copyBtn);
      header.appendChild(langSelect);
      header.appendChild(actions);

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);

      const mermaidPreview = document.createElement('div');
      mermaidPreview.className = 'emdi-mermaid-preview hidden';
      mermaidPreview.contentEditable = 'false';

      const dataviewPreview = document.createElement('div');
      dataviewPreview.className = 'emdi-dataview-preview hidden';
      dataviewPreview.contentEditable = 'false';

      wrapper.appendChild(header);
      wrapper.appendChild(mermaidPreview);
      wrapper.appendChild(dataviewPreview);
      wrapper.appendChild(pre);

      const isMermaid = () => String(currentNode.attrs.language ?? '').toLowerCase() === 'mermaid';
      const isDataview = () => String(currentNode.attrs.language ?? '').toLowerCase() === 'dataview';
      let showDataviewCode = false;
      let lastRenderedDvSource = '';

      const renderDataview = async (force = false) => {
        if (!isDataview()) {
          dataviewPreview.classList.add('hidden');
          if (!isMermaid()) {
            mermaidToggleBtn.classList.add('hidden');
            pre.classList.remove('hidden');
          }
          return;
        }

        mermaidPreview.classList.add('hidden');
        mermaidToggleBtn.classList.remove('hidden');
        mermaidToggleBtn.textContent = showDataviewCode ? '표 보기' : '쿼리 편집';

        if (showDataviewCode) {
          dataviewPreview.classList.add('hidden');
          pre.classList.remove('hidden');
          return;
        }

        const source = currentNode.textContent.trim();
        if (!source) {
          dataviewPreview.classList.add('hidden');
          pre.classList.remove('hidden');
          return;
        }

        if (!force && source === lastRenderedDvSource && dataviewPreview.childElementCount > 0) {
          dataviewPreview.classList.remove('hidden');
          pre.classList.add('hidden');
          return;
        }

        dataviewPreview.classList.remove('hidden');
        pre.classList.add('hidden');
        const supported = await renderDataviewInto(dataviewPreview, source, (filePath) => {
          openFilePathHandler(filePath);
        });
        if (!supported) {
          // Unsupported advanced Dataview syntax: fall back cleanly to raw code block
          dataviewPreview.classList.add('hidden');
          mermaidToggleBtn.classList.add('hidden');
          pre.classList.remove('hidden');
          return;
        }
        lastRenderedDvSource = source;
      };

      const renderMermaid = async (force = false) => {
        if (!isMermaid()) {
          mermaidPreview.classList.add('hidden');
          mermaidToggleBtn.classList.add('hidden');
          pre.classList.remove('hidden');
          return;
        }

        mermaidToggleBtn.classList.remove('hidden');
        mermaidToggleBtn.textContent = showMermaidCode ? '다이어그램 보기' : '코드 편집';

        if (showMermaidCode) {
          mermaidPreview.classList.add('hidden');
          pre.classList.remove('hidden');
          return;
        }

        const source = currentNode.textContent.trim();
        if (!source) {
          mermaidPreview.innerHTML = '<div class="emdi-mermaid-empty">Mermaid 코드를 입력하려면 우측 "코드 편집"을 누르세요</div>';
          mermaidPreview.classList.remove('hidden');
          pre.classList.add('hidden');
          return;
        }

        if (!force && source === lastRenderedSource && mermaidPreview.querySelector('svg')) {
          mermaidPreview.classList.remove('hidden');
          pre.classList.add('hidden');
          return;
        }

        const renderId = `emdi-mermaid-${++mermaidRenderSeq}`;
        try {
          const mermaid = await getMermaid();
          const { svg } = await mermaid.render(renderId, source);
          lastRenderedSource = source;
          mermaidPreview.innerHTML = svg;
          mermaidPreview.classList.remove('hidden');
          pre.classList.add('hidden');
        } catch (err) {
          document.getElementById(`d${renderId}`)?.remove();
          document.getElementById(renderId)?.remove();
          const msg = err instanceof Error ? err.message : 'Mermaid 구문 오류';
          mermaidPreview.innerHTML = '';
          const errDiv = document.createElement('div');
          errDiv.className = 'emdi-mermaid-error';
          errDiv.textContent = `다이어그램 구문 오류: ${msg.slice(0, 140)}`;
          mermaidPreview.appendChild(errDiv);
          mermaidPreview.classList.remove('hidden');
          pre.classList.remove('hidden');
        }
      };

      langSelect.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos === 'number') {
          editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              language: langSelect.value || null,
            });
            return true;
          });
        }
      });

      mermaidToggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isDataview()) {
          showDataviewCode = !showDataviewCode;
          void renderDataview(true);
          if (showDataviewCode) {
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (typeof pos === 'number') {
              editor.commands.setTextSelection(pos + 1);
              editor.commands.focus();
            }
          }
          return;
        }
        showMermaidCode = !showMermaidCode;
        void renderMermaid(true);
        if (showMermaidCode) {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos === 'number') {
            editor.commands.setTextSelection(pos + 1);
            editor.commands.focus();
          }
        }
      });

      mermaidPreview.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showMermaidCode = true;
        void renderMermaid(false);
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos === 'number') {
          editor.commands.setTextSelection(pos + 1);
          editor.commands.focus();
        }
      });

      copyBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = currentNode.textContent;
        copyFeedbackHandler(text);
        copyBtn.textContent = '복사됨';
        copyBtn.classList.add('copied');
        window.setTimeout(() => {
          copyBtn.textContent = '복사';
          copyBtn.classList.remove('copied');
        }, 1500);
      });

      syncLanguageOptions(String(currentNode.attrs.language ?? ''));
      if (isMermaid()) {
        if (!currentNode.textContent.trim()) {
          showMermaidCode = true;
        }
        void renderMermaid(true);
      } else if (isDataview()) {
        if (!currentNode.textContent.trim()) {
          showDataviewCode = true;
        }
        void renderDataview(true);
      }

      return {
        dom: wrapper,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type !== currentNode.type) return false;
          const prevLang = String(currentNode.attrs.language ?? '');
          const nextLang = String(updatedNode.attrs.language ?? '');
          const textChanged = updatedNode.textContent !== currentNode.textContent;
          currentNode = updatedNode;

          if (prevLang !== nextLang) {
            syncLanguageOptions(nextLang);
            if (nextLang.toLowerCase() === 'mermaid' && prevLang.toLowerCase() !== 'mermaid') {
              showMermaidCode = !updatedNode.textContent.trim();
            }
            if (nextLang.toLowerCase() === 'dataview' && prevLang.toLowerCase() !== 'dataview') {
              showDataviewCode = !updatedNode.textContent.trim();
            }
            void renderMermaid(true);
            void renderDataview(true);
          } else if (textChanged && isMermaid() && !showMermaidCode) {
            if (renderDebounce) window.clearTimeout(renderDebounce);
            renderDebounce = window.setTimeout(() => void renderMermaid(true), 250);
          } else if (textChanged && isDataview() && !showDataviewCode) {
            if (renderDebounce) window.clearTimeout(renderDebounce);
            renderDebounce = window.setTimeout(() => void renderDataview(true), 350);
          }
          return true;
        },
        stopEvent: (event: Event) => {
          const target = event.target as HTMLElement | null;
          if (!target) return false;
          if (header.contains(target) || mermaidPreview.contains(target) || dataviewPreview.contains(target)) {
            return true;
          }
          return false;
        },
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          const target = mutation.target as HTMLElement | null;
          if (!target) return true;
          if (code.contains(target)) return false;
          return true;
        },
        destroy: () => {
          if (renderDebounce) window.clearTimeout(renderDebounce);
        },
      };
    };
  },
});

// ── 5. Obsidian Callout Decorator (> [!NOTE], > [!TIP], > [!WARNING], etc.) ──

const CALLOUT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|TODO|EXAMPLE|QUOTE|SUCCESS|QUESTION|BUG|FAILURE|DANGER)\]([+-])?(?:\s+(.*))?$/i;

const CALLOUT_KIND_MAP: Record<string, string> = {
  note: 'note',
  info: 'note',
  todo: 'note',
  tip: 'tip',
  success: 'tip',
  important: 'important',
  example: 'important',
  warning: 'warning',
  question: 'warning',
  caution: 'caution',
  danger: 'caution',
  bug: 'caution',
  failure: 'caution',
  quote: 'quote',
};

function buildCalloutDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return;
    const firstChild = node.firstChild;
    if (!firstChild || firstChild.type.name !== 'paragraph') return;
    const firstLine = firstChild.textContent.split('\n')[0].trim();
    const match = firstLine.match(CALLOUT_RE);
    if (!match) return;
    const rawType = match[1].toLowerCase();
    const kind = CALLOUT_KIND_MAP[rawType] ?? 'note';
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `emdi-callout callout-${kind}`,
        'data-callout': rawType.toUpperCase(),
      })
    );
  });
  return DecorationSet.create(doc, decorations);
}

export const CalloutDecorator = Extension.create({
  name: 'calloutDecorator',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('emdiCalloutDecorator'),
        state: {
          init: (_, state) => buildCalloutDecorations(state.doc),
          apply: (tr, oldSet, _, newState) => {
            if (!tr.docChanged) return oldSet;
            return buildCalloutDecorations(newState.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// ── 5b. Inline Code URL Decorator (Safe ProseMirror decoration instead of DOM mutation) ──

const INLINE_CODE_URL_RE = /^https?:\/\/[^\s<>()]+$/i;

function buildInlineCodeUrlDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false;
    if (!node.isText || !node.text) return true;
    const hasCodeMark = node.marks.some((m) => m.type.name === 'code');
    if (!hasCodeMark) return true;
    const trimmed = node.text.trim();
    if (!INLINE_CODE_URL_RE.test(trimmed)) return true;
    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, {
        class: 'code-url',
        'data-code-url': trimmed,
      })
    );
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

export const InlineCodeUrlDecorator = Extension.create({
  name: 'inlineCodeUrlDecorator',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('emdiInlineCodeUrlDecorator'),
        state: {
          init: (_, state) => buildInlineCodeUrlDecorations(state.doc),
          apply: (tr, oldSet, _, newState) => {
            if (!tr.docChanged) return oldSet;
            return buildInlineCodeUrlDecorations(newState.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// ── 6. Search Highlight Extension (For Find & Replace in WYSIWYG) ──

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchPluginState {
  query: string;
  caseSensitive: boolean;
  activeIndex: number;
  matches: SearchMatch[];
  decorations: DecorationSet;
}

export const searchPluginKey = new PluginKey<SearchPluginState>('emdiSearchHighlight');

export function computeDocMatches(doc: PMNode, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let blockText = '';
    const posMap: number[] = [];

    node.descendants((child, childOffset) => {
      if (child.isText && child.text) {
        const absStart = pos + 1 + childOffset;
        for (let i = 0; i < child.text.length; i++) {
          blockText += child.text[i];
          posMap.push(absStart + i);
        }
      } else if (child.isInline && child.isLeaf) {
        blockText += '\uFFFC';
        posMap.push(pos + 1 + childOffset);
      }
    });

    if (!blockText) return false;
    const haystack = caseSensitive ? blockText : blockText.toLowerCase();
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
      const startPos = posMap[idx];
      const endPos = posMap[idx + needle.length - 1] + 1;
      matches.push({ from: startPos, to: endPos });
      idx = haystack.indexOf(needle, idx + Math.max(1, needle.length));
    }
    return false;
  });

  return matches;
}

function buildSearchDecorations(doc: PMNode, matches: SearchMatch[], activeIndex: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, idx) =>
    Decoration.inline(m.from, m.to, {
      class: idx === activeIndex ? 'emdi-search-match current' : 'emdi-search-match',
    })
  );
  return DecorationSet.create(doc, decos);
}

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchPluginState>({
        key: searchPluginKey,
        state: {
          init: () => ({
            query: '',
            caseSensitive: false,
            activeIndex: 0,
            matches: [],
            decorations: DecorationSet.empty,
          }),
          apply: (tr, prev, _, newState) => {
            const meta = tr.getMeta(searchPluginKey) as
              | Partial<{ query: string; caseSensitive: boolean; activeIndex: number }>
              | undefined;
            if (!meta && !tr.docChanged) {
              return prev;
            }
            const query = meta?.query !== undefined ? meta.query : prev.query;
            const caseSensitive = meta?.caseSensitive !== undefined ? meta.caseSensitive : prev.caseSensitive;
            const matches = computeDocMatches(newState.doc, query, caseSensitive);
            let activeIndex = meta?.activeIndex !== undefined ? meta.activeIndex : prev.activeIndex;
            if (matches.length === 0) {
              activeIndex = 0;
            } else {
              activeIndex = ((activeIndex % matches.length) + matches.length) % matches.length;
            }
            const decorations = buildSearchDecorations(newState.doc, matches, activeIndex);
            return { query, caseSensitive, activeIndex, matches, decorations };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
