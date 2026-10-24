import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSystemAdapter, Platform } from 'obsidian';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import DrawioPlugin from '../src/main';
import { DrawioEditor } from '../src/editor/DrawioEditor';
import { DEFAULT_SETTINGS } from '../src/settings';

const entries = [{ xml: 'compressed', w: 100, h: 40, title: '模块' }];
const library = (data = entries) => `<mxlibrary>${JSON.stringify(data)}</mxlibrary>`;
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'drawio-library-'));
  dirs.push(dir);
  await mkdir(join(dir, 'tools'));
  await writeFile(join(dir, 'tools', '常用.xml'), library());
  const read = vi.fn((path: string) => readFile(join(dir, path), 'utf8'));
  const adapter = Object.assign(new FileSystemAdapter(), { getBasePath: () => dir, read });
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, commonLibraryPath: 'tools/常用.xml' },
    app: { vault: { adapter } },
    resolveBaseUrl: async () => 'http://127.0.0.1:1234/index.html',
  } as unknown as DrawioPlugin;
  const deps = DrawioPlugin.prototype.editorDeps.call(plugin);
  await deps.resolveBaseUrl();
  return { dir, read, plugin, deps };
}

describe('common library host loading', () => {
  it.each(['missing', 'malformed', 'empty'] as const)('opens the ordinary editor when the selected native library is %s', async (failure) => {
    const { dir, plugin } = await fixture();
    if (failure === 'missing') plugin.settings.commonLibraryPath = 'tools/missing.xml';
    else await writeFile(join(dir, 'tools', '常用.xml'), failure === 'empty' ? '<mxlibrary>[]</mxlibrary>' : '<mxlibrary>broken</mxlibrary>');
    const deps = DrawioPlugin.prototype.editorDeps.call(plugin);
    deps.acquireServer = vi.fn();
    deps.releaseServer = vi.fn();
    deps.isDark = () => false;
    const container = document.body.createDiv();
    const editor = new DrawioEditor(container, {
      title: () => 'test', read: async () => '<mxfile/>', write: async () => {},
    }, deps);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await editor.mount();
      const iframe = container.querySelector('iframe')!;
      expect(iframe).not.toBeNull();
      expect(new URL(iframe.src).searchParams.has('libs')).toBe(false);
      const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow, origin: 'http://127.0.0.1:1234',
        data: JSON.stringify({ event: 'configure' }),
      }));
      expect(JSON.parse(post.mock.calls[0]![0])).toEqual({ action: 'configure', config: { compressXml: false } });
      expect(error).toHaveBeenCalledWith(expect.stringContaining('common shape library'), expect.any(Error));
    } finally { editor.destroy(); container.remove(); error.mockRestore(); }
  });
  it.each(['file', 'directory'] as const)('rejects %s symlinks escaping the real Vault boundary before reading their content', async (kind) => {
    const { dir, plugin, deps, read } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'drawio-library-outside-'));
    dirs.push(outside);
    await writeFile(join(outside, 'private.xml'), library());
    if (kind === 'file') {
      await symlink(join(outside, 'private.xml'), join(dir, 'escape.xml'));
      plugin.settings.commonLibraryPath = 'escape.xml';
    } else {
      await symlink(outside, join(dir, 'external'));
      plugin.settings.commonLibraryPath = 'external/private.xml';
    }
    await expect(deps.loadCommonLibrary!()).rejects.toThrow(/outside.*Vault/);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects adapters without a verifiable desktop filesystem boundary', async () => {
    const { plugin, deps } = await fixture();
    const read = vi.fn(async () => library());
    Object.assign(plugin.app.vault, { adapter: { read } });
    await expect(deps.loadCommonLibrary!()).rejects.toThrow(/desktop.*vault/i);
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    '/tmp/common.xml', 'C:/common.xml', 'C:\\common.xml', '\\\\server\\common.xml',
    'https://example.com/common.xml', 'file:///tmp/common.xml',
    '../common.xml', 'tools/../../common.xml', 'tools/../common.xml',
    'tools/common.json', 'tools/common.xml?x=1', 'tools\\common.xml',
  ])('rejects unsafe or non-XML Vault paths before adapter reads: %s', async (path) => {
    const { plugin, deps, read } = await fixture();
    plugin.settings.commonLibraryPath = path;
    await expect(deps.loadCommonLibrary!()).rejects.toThrow(/Vault-relative.*\.xml/);
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['online', 'custom'] as const)('does not read or send private libraries in %s mode, even for a loopback custom URL', async (mode) => {
    const { plugin, read } = await fixture();
    plugin.settings.drawioMode = mode;
    const deps = DrawioPlugin.prototype.editorDeps.call(plugin);
    await deps.resolveBaseUrl();
    plugin.settings.drawioMode = 'offline'; // changing settings must not bless the already-resolved URL
    await expect(deps.loadCommonLibrary!()).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps empty paths disabled without disk reads', async () => {
    const { plugin, deps, read } = await fixture();
    plugin.settings.commonLibraryPath = '';
    await expect(deps.loadCommonLibrary!()).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('does not load local libraries on mobile', async () => {
    const { deps, read } = await fixture();
    const original = Platform.isDesktopApp;
    try {
      Platform.isDesktopApp = false;
      await expect(deps.loadCommonLibrary!()).resolves.toBeNull();
      expect(read).not.toHaveBeenCalled();
    } finally { Platform.isDesktopApp = original; }
  });
  it('re-reads the Vault XML and registers fresh entries on each newly mounted editor without indexing or caching', async () => {
    const { dir, read, plugin } = await fixture();
    const updated = [{ xml: 'changed', w: 40, h: 20, title: '新组件' }];
    for (const data of [entries, updated]) {
      await writeFile(join(dir, 'tools', '常用.xml'), library(data));
      const deps = DrawioPlugin.prototype.editorDeps.call(plugin);
      deps.acquireServer = vi.fn();
      deps.releaseServer = vi.fn();
      deps.isDark = () => false;
      const container = document.body.createDiv();
      const editor = new DrawioEditor(container, {
        title: () => 'test', read: async () => '<mxfile/>', write: async () => {},
      }, deps);
      try {
        await editor.mount();
        const iframe = container.querySelector('iframe')!;
        expect(new URL(iframe.src).searchParams.get('libs')).toBe('obsidian-common');
        const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
        window.dispatchEvent(new MessageEvent('message', {
          source: iframe.contentWindow, origin: 'http://127.0.0.1:1234',
          data: JSON.stringify({ event: 'configure' }),
        }));
        expect(JSON.parse(post.mock.calls[0]![0]).config.libraries[0].entries[0].libs[0].data).toEqual(data);
      } finally { editor.destroy(); container.remove(); }
    }
    expect(read.mock.calls).toEqual([['tools/常用.xml'], ['tools/常用.xml']]);
  });
});
