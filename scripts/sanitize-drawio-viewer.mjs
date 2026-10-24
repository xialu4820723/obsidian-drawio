import { createHash } from 'node:crypto';

// Only these two reviewed 32.6.1 methods are replaced. Do not rewrite the
// surrounding viewer or introduce a general minified-JavaScript parser.
const PREVIEW_REPLACEMENTS = [
  {
    name: 'Editor.loadMath',
    sha256: 'd3df0b4d7d13a7bd047f08dcd8243d51bea8cda5293fdba62d20b55480f3e0d5',
    pattern: /Editor\.loadMath=function\(v\)\{[\s\S]*?\};(?=Editor\.MathJaxRender=)/g,
    // Match upstream's load-failure semantics: finish queued renders and notify
    // callbacks, leaving formula text visible without fetching a CDN bundle.
    replacement: 'Editor.loadMath=function(callback){X=!0;var queue=Editor.mathJaxQueue;' +
      'Editor.mathJaxQueue=[];for(var i=0;i<queue.length;i++)Editor.onMathJaxDone();' +
      'f();if(null!=callback)callback()};',
  },
  {
    name: 'EditorUi.prototype.addSvgIconHandlers',
    sha256: '9b1fcda9633ee24916337ac17319f86371714236edc5dd5308f27c4e80a8788b',
    pattern: /EditorUi\.prototype\.addSvgIconHandlers=function\(c,f\)\{[\s\S]*?\};(?=EditorUi\.prototype\.exportSvg=)/g,
    // Interactive SVG export is not used by static previews. In particular, do
    // not generate its SVG script (including the createElementNS branch).
    replacement: 'EditorUi.prototype.addSvgIconHandlers=function(){};',
  },
];

/** @param {string} original @returns {string} */
export function sanitizeDrawioViewer(original) {
  let contents = original;
  for (const { name, pattern, sha256, replacement } of PREVIEW_REPLACEMENTS) {
    const matches = [...contents.matchAll(pattern)];
    if (matches.length !== 1) {
      throw new Error(
        `sanitize-drawio-viewer: expected exactly 1 ${name} method, found ${matches.length}. ` +
        'Review the upstream viewer and update scripts/sanitize-drawio-viewer.mjs.',
      );
    }
    // Boundary matching locates a method, not arbitrary JavaScript syntax. Only
    // accept the exact reviewed body, so a changed delimiter/body fails closed.
    if (createHash('sha256').update(matches[0][0]).digest('hex') !== sha256) {
      throw new Error(`sanitize-drawio-viewer: reviewed body changed for ${name}; review upstream.`);
    }
    contents = contents.replace(pattern, replacement);
  }
  if (/\bcreateElement\s*\(\s*['"]script['"]\s*\)/i.test(contents) ||
      /\bcreateElementNS\s*\(\s*[^,;()]+,\s*['"]script['"]\s*\)/i.test(contents)) {
    throw new Error(
      'sanitize-drawio-viewer: script creation still present after replacing ' +
      'the reviewed methods; aborting to avoid shipping it.',
    );
  }
  return contents;
}
