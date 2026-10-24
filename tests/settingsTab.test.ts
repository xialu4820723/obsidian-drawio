import { describe, it, expect, afterEach, vi } from 'vitest';
import { Platform } from 'obsidian';
import { DrawioSettingTab } from '../src/settingsTab';
import { DEFAULT_SETTINGS } from '../src/settings';
import { DRAWIO_VERSION } from '../src/constants';
import { InstallStatus } from '../src/model/installStatus';
import type DrawioPlugin from '../src/main';

function fakePlugin(overrides: Record<string, unknown> = {}): DrawioPlugin {
  return {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
    updateServerIdleTimeout: () => {},
    webappInstallStatus: new InstallStatus(),
    isWebappInstalled: async () => false,
    installedWebappVersion: async () => null,
    server: null,
    ...overrides,
  } as unknown as DrawioPlugin;
}

function rowNames(containerEl: HTMLElement): (string | null)[] {
  return Array.from(containerEl.querySelectorAll('.setting-item-name')).map((n) => n.textContent);
}

describe('DrawioSettingTab', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('shows the editor-only rows on desktop', () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).toContain('Editor source');
    expect(names).toContain('Server idle timeout (seconds)');
    expect(names).toContain('Show shape libraries');
    expect(names).toContain('New diagram location');
    expect(names).toContain('Open diagram files read-only');
    expect(names).toContain('Preview click action');
    expect(names).toContain('Migrate from the old Diagrams plugin');
    expect(names).not.toContain('Edit button action');
  });

  it('shows Edit button action only when Interactive viewer is selected', () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    plugin.settings.previewClickAction = 'interactive';
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).toContain('Edit button action');
    expect(names).not.toContain('File diagrams');
    expect(names).not.toContain('Inline code blocks');
    const group = tab.containerEl.querySelector<HTMLElement>('.drawio-edit-action-settings')!;
    const rows = Array.from(group.querySelectorAll<HTMLElement>('.drawio-edit-action-row'));
    expect(rows.map((row) =>
      row.querySelector('.drawio-edit-action-label')?.textContent,
    )).toEqual(['File diagrams', 'Inline code blocks']);
    const fileRow = rows[0]!;
    const inlineRow = rows[1]!;
    expect(fileRow.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false);
    expect(fileRow.querySelectorAll('option')).toHaveLength(2);
    expect(inlineRow.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true);
    expect(inlineRow.querySelector<HTMLSelectElement>('select')!.value).toBe('editor');
    expect(inlineRow.querySelectorAll('option')).toHaveLength(1);
  });

  it('saves shape defaults with an explicit inherit option and validates fill colors', () => {
    Platform.isDesktopApp = true;
    const saveSettings = vi.fn(async () => {});
    const plugin = fakePlugin({ saveSettings });
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const row = (name: string) => Array.from(tab.containerEl.querySelectorAll('.setting-item'))
      .find((el) => el.querySelector('.setting-item-name')?.textContent === name)!;
    const corners = row('Default shape corners').querySelector('select')!;
    expect(corners.value).toBe('inherit');
    corners.value = 'rounded';
    corners.dispatchEvent(new Event('change'));
    expect(plugin.settings.defaultShapeRounded).toBe(true);
    corners.value = 'sharp';
    corners.dispatchEvent(new Event('change'));
    expect(plugin.settings.defaultShapeRounded).toBe(false);
    corners.value = 'inherit';
    corners.dispatchEvent(new Event('change'));
    expect(plugin.settings.defaultShapeRounded).toBeNull();
    const fill = row('Default shape fill').querySelector('input')!;
    fill.value = '#f5f5f5';
    fill.dispatchEvent(new Event('input'));
    expect(plugin.settings.defaultShapeFillColor).toBe('#f5f5f5');
    expect(saveSettings).toHaveBeenCalledTimes(4);
    fill.value = 'url(https://example.com)';
    fill.dispatchEvent(new Event('input'));
    expect(fill.validity.valid).toBe(false);
    expect(plugin.settings.defaultShapeFillColor).toBe('#f5f5f5');
    expect(saveSettings).toHaveBeenCalledTimes(4);
    fill.value = '';
    fill.dispatchEvent(new Event('input'));
    expect(fill.validity.valid).toBe(true);
    expect(plugin.settings.defaultShapeFillColor).toBe('');
    expect(saveSettings).toHaveBeenCalledTimes(5);
  });

  it('saves a single Vault-relative common library path and can clear it', () => {
    Platform.isDesktopApp = true;
    const saveSettings = vi.fn(async () => {});
    const plugin = fakePlugin({ saveSettings });
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const row = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
      .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Common shape library');
    expect(row).toBeDefined();
    expect(row!.textContent).toContain('Offline');
    expect(row!.textContent).toContain('Online');
    expect(row!.textContent).toContain('Custom');
    const input = row!.querySelector('input')!;
    expect(input.value).toBe('');
    input.value = 'tools/DrawIO/常用组件.xml';
    input.dispatchEvent(new Event('input'));
    expect(plugin.settings.commonLibraryPath).toBe('tools/DrawIO/常用组件.xml');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(plugin.settings.commonLibraryPath).toBe('');
    expect(saveSettings).toHaveBeenCalledTimes(2);
  });

  it('hides the editor-only rows on mobile, keeps preview/theme rows', () => {
    Platform.isDesktopApp = false;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).not.toContain('Editor source');
    expect(names).not.toContain('Custom drawio URL');
    expect(names).not.toContain('Server idle timeout (seconds)');
    expect(names).not.toContain('Show shape libraries');
    expect(names).not.toContain('Default shape corners');
    expect(names).not.toContain('Default shape fill');
    expect(names).not.toContain('Common shape library');
    expect(names).not.toContain('New diagram location');
    expect(names).not.toContain('New diagram folder');
    expect(names).not.toContain('Open diagram files read-only');
    expect(names).not.toContain('Preview click action');
    expect(names).not.toContain('Edit button action');
    expect(names).not.toContain('Migrate from the old Diagrams plugin');
    expect(names).toContain('Preview alignment');
    expect(names).toContain('Follow Obsidian theme');
  });
});

describe('offline editor status row', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  function statusRow(containerEl: HTMLElement): HTMLElement | null {
    return Array.from(containerEl.querySelectorAll('.setting-item')).find((el) =>
      el.querySelector('.setting-item-name')?.textContent === 'Offline editor',
    ) as HTMLElement ?? null;
  }

  it('is shown in offline mode and offers Install when not installed', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const row = statusRow(tab.containerEl);
    expect(row).not.toBeNull();
    await vi.waitFor(() => {
      expect(row!.querySelector('button')?.textContent).toBe('Install');
      expect(row!.querySelector('.setting-item-description')?.textContent).toContain('Not installed');
    });
  });

  it('offers Reinstall and shows the version when installed', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin({
      isWebappInstalled: async () => true,
      installedWebappVersion: async () => DRAWIO_VERSION,
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      expect(row.querySelector('button')?.textContent).toBe('Reinstall');
      expect(row.querySelector('.setting-item-description')?.textContent).toContain(DRAWIO_VERSION);
    });
  });

  it('offers Update (with CTA) when the installed version differs from the pinned one', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin({
      isWebappInstalled: async () => true,
      installedWebappVersion: async () => 'v29.0.0',
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      const button = row.querySelector<HTMLButtonElement>('button')!;
      expect(button.textContent).toBe('Update');
      expect(button.classList.contains('mod-cta')).toBe(true);
      const desc = row.querySelector('.setting-item-description')?.textContent ?? '';
      expect(desc).toContain('v29.0.0');
      expect(desc).toContain(DRAWIO_VERSION);
    });
  });

  it('keeps Reinstall (no update prompt) when the installed version is unknown', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin({
      isWebappInstalled: async () => true,
      installedWebappVersion: async () => null,
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      const button = row.querySelector<HTMLButtonElement>('button')!;
      expect(button.textContent).toBe('Reinstall');
      expect(button.classList.contains('mod-cta')).toBe(false);
      expect(row.querySelector('.setting-item-description')?.textContent).toBe('Installed.');
    });
  });

  it('renders live progress while an install is running', async () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    (plugin as unknown as { webappInstallStatus: InstallStatus }).webappInstallStatus
      .set({ status: 'installing', progressText: 'Downloading… 42%' });
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const row = statusRow(tab.containerEl)!;
    expect(row.querySelector('.setting-item-description')?.textContent).toBe('Downloading… 42%');
    expect(row.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  });

  it('is absent in online mode', () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    (plugin as unknown as { settings: { drawioMode: string } }).settings.drawioMode = 'online';
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    expect(statusRow(tab.containerEl)).toBeNull();
  });

  it('drops the CTA styling once the button leaves the Install state', async () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const row = statusRow(tab.containerEl)!;
    const button = row.querySelector<HTMLButtonElement>('button')!;
    await vi.waitFor(() => {
      expect(button.textContent).toBe('Install');
      expect(button.classList.contains('mod-cta')).toBe(true);
    });
    (plugin as unknown as { webappInstallStatus: InstallStatus }).webappInstallStatus
      .set({ status: 'installing', progressText: 'Downloading… 10%' });
    expect(button.textContent).toBe('Installing…');
    expect(button.classList.contains('mod-cta')).toBe(false);
  });
});
