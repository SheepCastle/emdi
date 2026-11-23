export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif|ico)$/i;

export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function splitFrontmatter(raw: string): { hasFm: boolean; fm: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { hasFm: false, fm: '', body: raw };
  }
  const fm = match[1];
  const body = raw.slice(match[0].length).replace(/^\r?\n/, '');
  return { hasFm: true, fm, body };
}

export function joinFrontmatter(hasFm: boolean, fm: string, body: string): string {
  if (!hasFm) return body;
  const trimmedFm = fm.replace(/\s+$/, '');
  return `---\n${trimmedFm}\n---\n\n${body}`;
}

/**
 * Preprocess Obsidian syntax and highlight syntax outside code fences and inline code:
 * 1. ![[image.png]] or ![[image.png|alt]] -> <img ... data-wiki="true" ... />
 * 2. [[Note]] or [[Note|Alias]] or [[Note#Heading]] -> <span data-wikilink="true" ...>label</span>
 * 3. ==highlighted== -> <mark>highlighted</mark>
 */
export function preprocessMarkdownForEditor(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let fenceChar = '';

  const processed = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      return line;
    }
    if (inFence) return line;

    // Split by inline code spans so we don't touch syntax inside backticks
    const parts = line.split(/(`[^`]*`)/g);
    return parts
      .map((part, idx) => {
        if (idx % 2 === 1) return part;

        // 1. Obsidian image embeds ![[...]]
        let out = part.replace(/!\[\[([^\]]+)\]\]/g, (full, inner: string) => {
          const pipeIdx = inner.indexOf('|');
          const rawTarget = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
          const rawAlias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : '';
          if (!rawTarget || !IMAGE_EXT_RE.test(rawTarget)) {
            return full;
          }
          const alt = rawAlias && !/^\d+(x\d+)?$/i.test(rawAlias) ? rawAlias : rawTarget;
          return `<img src="${escapeHtmlAttr(rawTarget)}" data-raw-src="${escapeHtmlAttr(rawTarget)}" alt="${escapeHtmlAttr(alt)}" data-wiki="true" data-wiki-raw="${escapeHtmlAttr(inner)}" />`;
        });

        // 2. Obsidian wikilinks [[...]] (not preceded by !)
        out = out.replace(/(^|[^!])\[\[([^\]]+)\]\]/g, (_full, prefix: string, inner: string) => {
          const pipeIdx = inner.indexOf('|');
          const rawTarget = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
          const rawAlias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : '';
          if (!rawTarget) return `${prefix}[[${inner}]]`;
          const displayLabel = rawAlias || rawTarget.replace(/\.md$/i, '');
          return `${prefix}<span data-wikilink="true" data-wiki-raw="${escapeHtmlAttr(inner)}" data-wiki-target="${escapeHtmlAttr(rawTarget)}" data-wiki-alias="${escapeHtmlAttr(rawAlias)}">${escapeHtmlText(displayLabel)}</span>`;
        });

        // 3. Highlight syntax ==text==
        out = out.replace(/==(?=\S)(.+?)(?<=\S)==/g, (_full, inner: string) => {
          return `<mark>${inner}</mark>`;
        });

        // 4. CJK/Korean-friendly **bold** (fixes CommonMark flanking rule when punctuation meets Korean particles like **KDL(예시)**은)
        out = out.replace(
          /(?<![\\*])\*\*(?!\*)(?=\S)((?:(?!\*\*).)+?)(?<=\S)(?<![\\*])\*\*(?!\*)/g,
          (_full, inner: string) => `<strong>${inner}</strong>`
        );

        // 5. CJK/Korean-friendly ~~strikethrough~~
        out = out.replace(
          /(?<![\\~])~~(?!~)(?=\S)((?:(?!~~).)+?)(?<=\S)(?<![\\~])~~(?!~)/g,
          (_full, inner: string) => `<s>${inner}</s>`
        );

        return out;
      })
      .join('');
  });

  return processed.join('\n');
}
