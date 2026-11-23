import type { FileKind } from '../types';

export const CHEVRON_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6.2 4.2L10 8l-3.8 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const FOLDER_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.2 4.5A1.3 1.3 0 0 1 3.5 3.2h2.7l1.3 1.4h5a1.3 1.3 0 0 1 1.3 1.3v5.6a1.3 1.3 0 0 1-1.3 1.3h-9a1.3 1.3 0 0 1-1.3-1.3v-7z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`;

const MD_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 2.5h5.2L12.5 5.8v7.7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M9 2.5V6h3.5" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`;

const HTML_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.25"/><path d="M2.6 8h10.8M8 2.4c1.6 1.7 2.4 3.6 2.4 5.6S9.6 11.9 8 13.6C6.4 11.9 5.6 10 5.6 8S6.4 4.1 8 2.4z" stroke="currentColor" stroke-width="1.15"/></svg>`;

const PDF_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2" width="11" height="12" rx="1.6" stroke="currentColor" stroke-width="1.25"/><path d="M5 6.2h6M5 8.8h6M5 11.2h3.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

const IMAGE_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.6" stroke="currentColor" stroke-width="1.25"/><circle cx="5.7" cy="6.1" r="1.1" fill="currentColor"/><path d="M3 11.4l3.1-3.1 2.2 2.1 1.7-1.6 2.9 2.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CODE_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5.6 4.6L2.4 8l3.2 3.4M10.4 4.6L13.6 8l-3.2 3.4M9 3.4L7 12.6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const TEXT_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4.2h10M3 7.2h10M3 10.2h7.2M3 13h5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`;

const EXTERNAL_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6.8 3.2H3.8A1.3 1.3 0 0 0 2.5 4.5v7.7a1.3 1.3 0 0 0 1.3 1.3h7.7a1.3 1.3 0 0 0 1.3-1.3v-3M9.2 2.5h4.3v4.3M7.5 8.5l5.8-5.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function getFileIconSVG(kind: FileKind): string {
  switch (kind) {
    case 'dir':
      return FOLDER_SVG;
    case 'markdown':
      return MD_SVG;
    case 'html':
      return HTML_SVG;
    case 'pdf':
      return PDF_SVG;
    case 'image':
      return IMAGE_SVG;
    case 'code':
      return CODE_SVG;
    case 'text':
      return TEXT_SVG;
    case 'external':
    default:
      return EXTERNAL_SVG;
  }
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
