import { MarkdownView, parseLinktext, TFile } from 'obsidian';
import { dualFormatOf } from '../model/dualFormat';
import type DrawioPlugin from '../main';

function resourceIdentity(src: string): string | null {
  try {
    const url = new URL(src);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Native image embeds keep a decoded image at the old mtime URL after a save.
 * Update only matching mounted images; never rebuild the note/editor. */
export function registerDualFormatRefresh(plugin: DrawioPlugin): void {
  const { vault, workspace } = plugin.app;
  plugin.registerEvent(vault.on('modify', (file) => {
    if (!(file instanceof TFile) || !dualFormatOf(file.path)) return;
    const resourcePath = vault.getResourcePath(file);
    const identity = resourceIdentity(resourcePath);
    if (!identity) return;
    workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!view.containerEl.isConnected) return;
      const refresh = (scope: HTMLElement): void => {
        for (const img of Array.from(scope.querySelectorAll<HTMLImageElement>('img'))) {
          // Nested transclusions resolve links relative to their own note, not
          // the top-level MarkdownView. The mounted resource is authoritative.
          if (resourceIdentity(img.src) !== identity) continue;
          img.src = resourcePath;
          // A subsequent save/detach can abort decoding; the native URL stays current.
          void img.decode?.().catch(() => {});
        }
      };
      if (view.getViewType() === 'image' && view.getState().file === file.path) {
        refresh(view.containerEl);
        return;
      }
      if (!(view instanceof MarkdownView) || !view.file) return;
      for (const embed of Array.from(view.containerEl.querySelectorAll<HTMLElement>('.internal-embed[src]'))) {
        const src = embed.getAttribute('src') ?? '';
        // A literal # may belong to the filename; only URLs are stripped above.
        if (!dualFormatOf(src) && !dualFormatOf(parseLinktext(src).path)) continue;
        refresh(embed);
      }
    });
  }));
}
