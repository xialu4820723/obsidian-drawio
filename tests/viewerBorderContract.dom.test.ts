import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  VIEWER_BORDER,
  VIEWER_SIZE_PADDING,
  VIEWBOX_CENTERING_SHIFT,
} from '../src/preview/ViewerRenderer';

/**
 * Pins the three GraphViewer layout facts that VIEWBOX_CENTERING_SHIFT is
 * derived from, by measuring them off the REAL vendored viewer:
 *
 *   1. it insets the diagram by an 8px border;
 *   2. it sizes the SVG as `bounds + 17` (via `min-width`/`min-height`);
 *   3. it half-pixel-aligns shapes (`translate(0.5,0.5)`).
 *
 * The padding includes the two borders and half-pixel alignment, leaving
 * equal margins and requiring no additional centering shift. The
 * final assertion closes the loop — it recomputes the shift from the measured
 * numbers and compares it against the shipped constant, so a drawio bump that
 * moves ANY of the three fails here.
 *
 * When it fails, re-derive the shift from the new values; do not relax the
 * assertions. Skips when `npm run fetch-drawio` hasn't been run, matching the
 * other suites that need the vendored blob.
 *
 * jsdom has no layout engine, but none is required: GraphViewer bakes the
 * border into an ancestor translation; the test combines that translation
 * with the shape coordinates to measure the effective border.
 */
const viewerPath = join(process.cwd(), 'src/preview/viewer.min.txt');
const hasViewer = existsSync(viewerPath);

const GEOM = { x: 400, y: 500, w: 120, h: 60 };
const XML =
  '<mxfile><diagram id="d" name="P"><mxGraphModel dx="0" dy="0" grid="0" '
  + 'page="1" pageWidth="850" pageHeight="1100"><root>'
  + '<mxCell id="0"/><mxCell id="1" parent="0"/>'
  + '<mxCell id="2" value="Box" style="rounded=0" vertex="1" parent="1">'
  + `<mxGeometry x="${GEOM.x}" y="${GEOM.y}" width="${GEOM.w}" height="${GEOM.h}" as="geometry"/>`
  + '</mxCell></root></mxGraphModel></diagram></mxfile>';

describe.skipIf(!hasViewer)('GraphViewer border/size contract', () => {
  let svg: SVGSVGElement;
  let shape: SVGRectElement;

  beforeAll(() => {
    const win = window as unknown as Record<string, unknown> & { eval: (c: string) => void };
    // Same offline pre-flight as loadViewer.ts, so the viewer neither fetches
    // resources nor auto-scans the document on load.
    win.mxLoadResources = false;
    win.mxLoadStylesheets = false;
    win.mxForceIncludes = false;
    win.STYLE_PATH = '.';
    win.RESOURCE_BASE = '.';
    win.mxBasePath = '.';
    win.PROXY_URL = '';
    win.onDrawioViewerLoad = (): void => { /* no-op */ };
    win.eval(readFileSync(viewerPath, 'utf8'));

    const mount = document.createElement('div');
    mount.className = 'mxgraph';
    mount.setAttribute('data-mxgraph', JSON.stringify({
      highlight: '#0000ff', nav: false, lightbox: false, toolbar: '', edit: null,
      'check-visible-state': false, 'dark-mode': 'off', page: 0, xml: XML,
    }));
    document.body.appendChild(mount);
    (win.GraphViewer as { createViewerForElement(el: HTMLElement): void })
      .createViewerForElement(mount);

    svg = mount.querySelector('svg')!;
    // The vertex: the only <rect> carrying the geometry's own width.
    shape = Array.from(svg.querySelectorAll('rect'))
      .find((r) => r.getAttribute('width') === String(GEOM.w))!;
  });

  it('insets the diagram by the border', () => {
    expect(shape, 'no rect matching the vertex geometry').toBeTruthy();
    expect(borderOffset('x')).toBe(VIEWER_BORDER);
    expect(borderOffset('y')).toBe(VIEWER_BORDER);
  });

  it('sizes the svg as bounds plus the padding', () => {
    expect(parseFloat(svg.style.minWidth)).toBe(GEOM.w + VIEWER_SIZE_PADDING);
    expect(parseFloat(svg.style.minHeight)).toBe(GEOM.h + VIEWER_SIZE_PADDING);
  });

  it('half-pixel-aligns shapes', () => {
    expect(halfPixelOffset()).toBe(0.5);
  });

  // The loop-closing check: derive the shift from what was just measured.
  it('agrees with the shipped centering shift', () => {
    const border = borderOffset('x');
    const padding = parseFloat(svg.style.minWidth) - GEOM.w;
    const align = halfPixelOffset();
    const left = border + align;
    const right = padding - border - align;
    expect(VIEWBOX_CENTERING_SHIFT).toBe((right - left) / 2);
  });

  // 32.6.1 leaves geometry in model coordinates and applies the border via
  // an ancestor translation; earlier versions baked it into rect attributes.
  function borderOffset(axis: 'x' | 'y'): number {
    let value = Number(shape.getAttribute(axis));
    for (let node = shape.parentElement; node && (node as Element) !== svg; node = node.parentElement) {
      const transform = node.getAttribute('transform') ?? '';
      if (transform === 'translate(0.5,0.5)') continue;
      const match = /^translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(transform);
      if (match) value += Number(match[axis === 'x' ? 1 : 2]);
    }
    return value;
  }

  /** The `translate(0.5,0.5)` GraphViewer wraps shapes in, or 0 if it stops. */
  function halfPixelOffset(): number {
    for (const g of Array.from(svg.querySelectorAll('g[transform]'))) {
      const m = /^translate\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(
        g.getAttribute('transform') ?? '');
      if (m && m[1] === m[2]) return Number(m[1]);
    }
    return 0;
  }
});
