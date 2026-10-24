import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, inflateRawSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';

/** Bundle the pinned webapp's XML libraries, compressed independently so a
 * preview only inflates/parses the libraries it actually uses. */
export async function bundleStencils(webappDir, output) {
  const files = {};
  const namespaces = {};
  function add(relative, xml) {
    files[relative] = gzipSync(xml, { level: 9 }).toString('base64');
    for (const match of xml.matchAll(/<shapes\b[^>]*\bname="([^"]+)"/g)) {
      const name = match[1].toLowerCase();
      (namespaces[name] ??= []).push(relative);
    }
  }
  async function visit(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        await visit(join(dir, entry.name), relative + '/');
      } else if (entry.name.endsWith('.xml')) {
        const xml = await readFile(join(dir, entry.name), 'utf8');
        add(relative, xml);
      }
    }
  }
  await visit(join(webappDir, 'stencils'));
  if (Object.keys(files).length === 0) {
    // 32.6.1 ships packed stencils instead of XML files. Execute its original
    // decoder only at build time, after fetch-drawio verifies the WAR digest.
    // Serialize its lightweight nodes back to XML for the existing runtime.
    const source = await readFile(join(webappDir, 'js/stencils.min.js'), 'utf8');
    const registry = { loadStencil() { throw new Error('Missing packed stencil'); } };
    runInNewContext(source, {
      mxStencilRegistry: registry, STENCIL_PATH: 'stencils', TextDecoder,
      atob: (value) => Buffer.from(value, 'base64').toString('binary'),
      pako: { inflateRaw: (value) => inflateRawSync(value) },
    }, { timeout: 10_000 });
    const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    function serialize(node) {
      const attrs = node.attributes.map(({ name, value }) => ` ${name}="${escape(value)}"`).join('');
      let children = '';
      for (let child = node.firstChild; child; child = child.nextSibling) children += serialize(child);
      return `<${node.nodeName}${attrs}>${children}</${node.nodeName}>`;
    }
    for (const match of source.matchAll(/f\['([^']+\.xml)'\] = '/g)) {
      add(match[1], serialize(registry.loadStencil('stencils/' + match[1]).documentElement));
    }
  }
  if (!namespaces['mxgraph.office.security']) throw new Error('Missing pinned Office stencils');
  await writeFile(output, JSON.stringify({ files, namespaces }));
}
