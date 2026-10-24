/** Native drawio library entries retain extension fields owned by the engine. */
export interface NativeLibraryEntry {
  xml?: string;
  data?: string;
  w: number;
  h: number;
  title?: string;
  [key: string]: unknown;
}

export function parseCommonLibrary(xml: string): NativeLibraryEntry[] {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('Library must not contain a DOCTYPE');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (doc.doctype || doc.querySelector('parsererror') || root.tagName !== 'mxlibrary' || root.children.length) {
    throw new Error('Expected a native mxlibrary XML file');
  }
  const entries: unknown = JSON.parse(root.textContent ?? '');
  if (!Array.isArray(entries) || entries.length === 0 || !entries.every(isNativeLibraryEntry)) {
    throw new Error('Library must contain a non-empty array of native entries (xml/data, w, h, optional title)');
  }
  return entries;
}

function isNativeLibraryEntry(value: unknown): value is NativeLibraryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (typeof entry.xml === 'string' && entry.xml.trim() !== '' ||
      typeof entry.data === 'string' && entry.data.trim() !== '') &&
    (entry.xml === undefined || typeof entry.xml === 'string') &&
    (entry.data === undefined || typeof entry.data === 'string') &&
    typeof entry.w === 'number' && Number.isFinite(entry.w) && entry.w >= 0 &&
    typeof entry.h === 'number' && Number.isFinite(entry.h) && entry.h >= 0 &&
    (entry.title === undefined || typeof entry.title === 'string');
}
