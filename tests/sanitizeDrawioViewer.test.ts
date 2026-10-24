import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DRAWIO_VERSION, DRAWIO_WAR_SHA256 } from '../src/constants';

const helperUrl = pathToFileURL(resolve('scripts/sanitize-drawio-viewer.mjs')).href;
const { sanitizeDrawioViewer }: { sanitizeDrawioViewer: (source: string) => string } = await import(helperUrl);
const original = readFileSync('src/preview/viewer.min.txt', 'utf8');

describe('drawio 32.6.1 preview build', () => {
  it('pins the reviewed official release and archive digest', () => {
    expect(DRAWIO_VERSION).toBe('v32.6.1');
    expect(DRAWIO_WAR_SHA256).toBe(
      '44dd56958c8408963457dc98f04d2228408ac145c7aa1d8e6895d9c88d5e42aa',
    );
    const script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
    expect(script.match(/DRAWIO_VERSION = '([^']+)'/)?.[1]).toBe(DRAWIO_VERSION);
    expect(script.match(/WAR_SHA256 = '([^']+)'/)?.[1]).toBe(DRAWIO_WAR_SHA256);
    expect(JSON.parse(readFileSync('drawio-version.json', 'utf8')).version).toBe(DRAWIO_VERSION);
  });

  it('rejects changed method bodies even when the method boundaries still match', () => {
    const changed = original.replace('z.setAttribute("src",u)', 'z.setAttribute("src","unexpected.js")');
    expect(changed).not.toBe(original);
    expect(() => sanitizeDrawioViewer(changed)).toThrow(/reviewed body.*Editor\.loadMath/);
  });

  it.each([
    ['Editor.loadMath', 'Editor.MathJaxRender='],
    ['EditorUi.prototype.addSvgIconHandlers', 'EditorUi.prototype.exportSvg='],
  ])('fails closed on missing or duplicate %s methods', (name, next) => {
    const start = original.indexOf(`${name}=function(`);
    const end = original.indexOf(next, start);
    const body = original.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(() => sanitizeDrawioViewer(original.replace(body, ''))).toThrow(/expected exactly 1 .*found 0/);
    expect(() => sanitizeDrawioViewer(`${original}\n${body}${next}`)).toThrow(/expected exactly 1 .*found 2/);
    expect(() => sanitizeDrawioViewer(original.replace(body, body.replace('function(', 'function ('))))
      .toThrow(/expected exactly 1 .*found 0/);
  });

  it.each([
    'document.createElement("script")',
    "document.createElement ( 'script' )",
    'document.createElementNS(mxConstants.NS_SVG,"script")',
    "document.createElementNS ( 'http://www.w3.org/2000/svg', 'script' )",
  ])('rejects an additional script creation path: %s', (extra) => {
    expect(() => sanitizeDrawioViewer(`${original}\n${extra};`)).toThrow(/script creation still present/);
  });

  it('preserves every byte outside the two reviewed methods', () => {
    const omitMethods = (source: string): string => source
      .replace(/Editor\.loadMath=function\([^)]*\)\{[\s\S]*?\};(?=Editor\.MathJaxRender=)/, '<math>')
      .replace(/EditorUi\.prototype\.addSvgIconHandlers=function\([^)]*\)\{[\s\S]*?\};(?=EditorUi\.prototype\.exportSvg=)/, '<icons>');
    const sanitized = sanitizeDrawioViewer(original);
    expect(sanitized).not.toBe(original);
    expect(omitMethods(sanitized)).toBe(omitMethods(original));
    expect(sanitized).not.toMatch(/createElement\s*\(\s*['"]script['"]/i);
    expect(sanitized).not.toMatch(/createElementNS\s*\([^,]+,\s*['"]script['"]/i);
  });

  it('evaluates the sanitized real viewer and keeps both disabled paths script-free', () => {
    const sanitized = sanitizeDrawioViewer(original);
    const win = window as unknown as Record<string, unknown>;
    Object.assign(win, {
      mxLoadResources: false, mxLoadStylesheets: false, mxForceIncludes: false,
      STYLE_PATH: '.', RESOURCE_BASE: '.', mxBasePath: '.', PROXY_URL: '',
      onDrawioViewerLoad: () => {},
    });
    // jsdom has no canvas implementation. Report the capability as unavailable;
    // this test exercises SVG rendering, not canvas-based feature detection.
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const dataUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('');
    const create = vi.spyOn(document, 'createElement');
    const createNS = vi.spyOn(document, 'createElementNS');
    try {
      window.eval(sanitized);
      const viewer = win.GraphViewer as { createViewerForElement: (el: HTMLElement) => void };
      expect(typeof viewer.createViewerForElement).toBe('function');

      const mount = document.createElement('div');
      mount.setAttribute('data-mxgraph', JSON.stringify({
        'check-visible-state': false, toolbar: '', nav: false, lightbox: false,
        xml: '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="2" vertex="1" parent="1"><mxGeometry x="40" y="40" width="160" height="60" as="geometry"/>' +
          '</mxCell></root></mxGraphModel></diagram></mxfile>',
      }));
      viewer.createViewerForElement(mount);
      expect(mount.querySelector('svg rect')?.getAttribute('width')).toBe('160');

      const editor = win.Editor as {
        loadMath: (callback?: () => void) => void;
        MathJaxRender: (container: HTMLElement) => void;
        mathJaxQueue: HTMLElement[];
        onMathJaxDone: () => void;
      };
      const completed = vi.spyOn(editor, 'onMathJaxDone');
      const callback = vi.fn();
      const label = document.createElement('div');
      editor.mathJaxQueue.push(label);
      editor.loadMath(callback);
      expect(editor.mathJaxQueue).toEqual([]);
      expect(completed).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
      editor.MathJaxRender(label);
      expect(completed).toHaveBeenCalledTimes(2);
      completed.mockRestore();

      const ui = win.EditorUi as { prototype: { addSvgIconHandlers: (svg: SVGSVGElement, wrappers: Element[]) => void } };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ui.prototype.addSvgIconHandlers(svg, []);
      expect(svg.childNodes).toHaveLength(0);
      expect(create.mock.calls.some(([tag]) => tag.toLowerCase() === 'script')).toBe(false);
      expect(createNS.mock.calls.some(([, tag]) => tag.toLowerCase() === 'script')).toBe(false);
    } finally {
      create.mockRestore();
      createNS.mockRestore();
      context.mockRestore();
      dataUrl.mockRestore();
    }
  });

  it('builds the actual upstream viewer through the production safety gate', () => {
    const result = spawnSync(process.execPath, ['esbuild.config.mjs', 'production'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
