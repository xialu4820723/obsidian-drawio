import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { DrawioModal } from '../src/editor/DrawioModal';

describe('DrawioModal return focus', () => {
  it('returns focus to the originating note without stealing focus from another note', () => {
    const focus = vi.fn();
    const view = { editor: { focus } };
    let activeView: unknown = view;
    const modal = new DrawioModal({ workspace: { getActiveViewOfType: () => activeView } } as unknown as App,
      { title: () => 'test', read: async () => '<mxfile/>', write: async () => {} },
      { resolveBaseUrl: async () => 'http://127.0.0.1:1234/', isDark: () => false,
        showLibraries: () => false, acquireServer: () => {}, releaseServer: () => {} });
    modal.onClose();
    expect(focus).toHaveBeenCalledTimes(1);
    activeView = { editor: { focus: vi.fn() } };
    modal.onClose();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
