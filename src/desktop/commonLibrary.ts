import { FileSystemAdapter, type DataAdapter } from 'obsidian';
import { parseCommonLibrary, type NativeLibraryEntry } from '../model/commonLibrary';

/** Desktop interactive-editor boundary; no headless exporter reads this file. */
export async function readCommonLibrary(adapter: DataAdapter, path: string): Promise<NativeLibraryEntry[]> {
  if (typeof path !== 'string' || !/\.xml$/i.test(path) || path.startsWith('/') ||
      path.includes('\\') || path.includes(':') ||
      path.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error('Common library requires a Vault-relative .xml path without traversal');
  }
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error('Common library requires a desktop filesystem vault');
  }
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const root = await fs.realpath(adapter.getBasePath());
  const target = await fs.realpath(nodePath.join(root, path));
  const relative = nodePath.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
    throw new Error('Common library resolves outside the Vault');
  }
  return parseCommonLibrary(await adapter.read(path));
}