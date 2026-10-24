import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(), Notice: vi.fn(),
}));
import { DrawioEditor, type DrawioEditorDeps } from '../src/editor/DrawioEditor';
import type { NativeLibraryEntry } from '../src/model/commonLibrary';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerManager } from '../src/server/ServerManager';

const ORIGIN = 'http://127.0.0.1:1234';
const entries: NativeLibraryEntry[] = [{ xml: 'compressed', w: 120, h: 60, title: '模块' }];
const editors: DrawioEditor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); vi.restoreAllMocks(); });

async function mount(loadCommonLibrary: () => Promise<NativeLibraryEntry[] | null>) {
  const container = document.body.createDiv();
  const deps: DrawioEditorDeps & { loadCommonLibrary: typeof loadCommonLibrary } = {
    resolveBaseUrl: async () => `${ORIGIN}/index.html`,
    isDark: () => false, showLibraries: () => true,
    defaultShapeStyle: { defaultShapeRounded: true, defaultShapeFillColor: '#F5F5F5' },
    acquireServer: vi.fn(), releaseServer: vi.fn(), loadCommonLibrary,
  };
  const editor = new DrawioEditor(container, {
    title: () => 'test', read: async () => '<mxfile/>', write: async () => {},
  }, deps);
  editors.push(editor);
  await editor.mount();
  const iframe = container.querySelector('iframe')!;
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
  const configure = (origin = ORIGIN, source = iframe.contentWindow) => {
    window.dispatchEvent(new MessageEvent('message', {
      source, origin, data: JSON.stringify({ event: 'configure' }),
    }));
  };
  return { editor, container, deps, iframe, post, configure };
}

describe('common native library', () => {
  it('keeps the resolved local server alive while a library read outlasts its idle timeout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'common-library-mount-'));
    await writeFile(join(dir, 'index.html'), '<html>editor</html>');
    const server = new ServerManager(dir, { min: 41380, max: 41389, idleMs: 5_000 });
    const container = document.body.createDiv();
    const editor = new DrawioEditor(container, {
      title: () => 'test', read: async () => '<mxfile/>', write: async () => {},
    }, {
      resolveBaseUrl: async () => `http://127.0.0.1:${await server.ensureStarted()}/index.html`,
      isDark: () => false, showLibraries: () => true,
      acquireServer: () => server.acquire(), releaseServer: () => server.release(),
      loadCommonLibrary: async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 5_200));
        return entries;
      },
    });
    try {
      await editor.mount();
      const response = await fetch(container.querySelector('iframe')!.src);
      expect(await response.text()).toBe('<html>editor</html>');
    } finally { editor.destroy(); container.remove(); server.stop(); await rm(dir, { recursive: true, force: true }); }
  }, 10_000);
  it.each(['resolve', 'reject'] as const)('does not mount or notify after destruction during a library %s', async (outcome) => {
    vi.mocked(Notice).mockClear();
    let resolve!: (value: NativeLibraryEntry[]) => void;
    let reject!: (error: Error) => void;
    const load = vi.fn(() => new Promise<NativeLibraryEntry[]>((yes, no) => { resolve = yes; reject = no; }));
    const container = document.body.createDiv();
    const acquireServer = vi.fn();
    const releaseServer = vi.fn();
    const editor = new DrawioEditor(container, {
      title: () => 'test', read: async () => '<mxfile/>', write: async () => {},
    }, {
      resolveBaseUrl: async () => `${ORIGIN}/index.html`,
      isDark: () => false, showLibraries: () => true,
      acquireServer, releaseServer, loadCommonLibrary: load,
    });
    editors.push(editor);
    const pending = editor.mount();
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    editor.destroy();
    if (outcome === 'resolve') resolve(entries);
    else reject(new Error('late read failure'));
    await pending;
    expect(acquireServer).toHaveBeenCalledTimes(1);
    expect(releaseServer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('iframe')).toBeNull();
    expect(Notice).not.toHaveBeenCalled();
  });
  it('notifies and falls back to ordinary native libraries when reading or parsing fails', async () => {
    const error = new Error('invalid mxlibrary');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = await mount(async () => { throw error; });
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('common shape library'));
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), error);
    expect(new URL(view.iframe.src).searchParams.has('libs')).toBe(false);
    view.configure();
    const config = JSON.parse(view.post.mock.calls[0]![0]).config;
    expect(config.libraries).toBeUndefined();
    expect(config.defaultLibraries).toBeUndefined();
    expect(config.defaultVertexStyle.rounded).toBe('1');
  });
  it('selects and registers fresh native entries on each new editor without disabling browser preferences or More Shapes', async () => {
    const load = vi.fn(async () => entries);
    const first = await mount(load);
    const url = new URL(first.iframe.src);
    expect(url.searchParams.get('libs')).toBe('obsidian-common');
    expect(url.searchParams.get('local')).toBeNull();
    expect(url.searchParams.get('libraries')).toBe('1');
    first.configure('https://untrusted.example');
    first.configure(ORIGIN, window);
    expect(first.post).not.toHaveBeenCalled();
    first.configure();
    const config = JSON.parse(first.post.mock.calls[0]![0]).config;
    expect(config).toEqual({
      compressXml: false,
      defaultVertexStyle: { rounded: '1', fillColor: '#F5F5F5' },
      defaultLibraries: 'obsidian-common',
      libraries: [{ title: { main: '常用' }, entries: [{
        id: 'obsidian-common', title: { main: '常用' },
        libs: [{ title: { main: '常用' }, data: entries }],
      }] }],
    });
    first.editor.destroy();
    const updated = [{ xml: 'updated', w: 40, h: 20, title: '新组件' }];
    load.mockResolvedValue(updated);
    const second = await mount(load);
    second.configure();
    expect(load).toHaveBeenCalledTimes(2);
    expect(JSON.parse(second.post.mock.calls[0]![0]).config.libraries[0].entries[0].libs[0].data).toEqual(updated);
  });
});
