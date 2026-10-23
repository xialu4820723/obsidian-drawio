import { describe, it, expect } from 'vitest';
import { buildLoadMessage, buildExportMessage, buildConfigureMessage, parseDrawioEvent } from '../src/editor/embedMessages';

describe('embedMessages', () => {
  it('builds a load message with autosave and theme', () => {
    const msg = JSON.parse(buildLoadMessage('<mxfile/>', { dark: true }));
    expect(msg).toEqual({ action: 'load', xml: '<mxfile/>', autosave: 1, modified: 0, dark: true });
  });

  it('builds an export-svg message', () => {
    const msg = JSON.parse(buildExportMessage('svg'));
    expect(msg).toEqual({ action: 'export', format: 'svg' });
  });

  it('builds a configure message that disables compression', () => {
    const msg = JSON.parse(buildConfigureMessage());
    expect(msg).toEqual({ action: 'configure', config: { compressXml: false } });
  });

  it('forwards persistent rounded corners and fill without changing compression', () => {
    const msg = JSON.parse(buildConfigureMessage({
      defaultShapeRounded: true, defaultShapeFillColor: '#F5F5F5',
    }));
    expect(msg).toEqual({
      action: 'configure',
      config: { compressXml: false, defaultVertexStyle: { rounded: '1', fillColor: '#F5F5F5' } },
    });
  });

  it('parses an init event', () => {
    expect(parseDrawioEvent(JSON.stringify({ event: 'init' }))).toEqual({ event: 'init' });
  });

  it('supports sharp corners independently and leaves unconfigured styles inherited', () => {
    expect(JSON.parse(buildConfigureMessage({ defaultShapeRounded: false }))).toEqual({
      action: 'configure', config: { compressXml: false, defaultVertexStyle: { rounded: '0' } },
    });
    expect(JSON.parse(buildConfigureMessage({ defaultShapeRounded: null, defaultShapeFillColor: '' })))
      .toEqual(JSON.parse(buildConfigureMessage()));
  });

  it('ignores invalid persisted fill values instead of forwarding arbitrary CSS', () => {
    expect(JSON.parse(buildConfigureMessage({ defaultShapeFillColor: 'url(https://example.com)' })))
      .toEqual(JSON.parse(buildConfigureMessage()));
  });

  it('allows a transparent fill and trims a valid persisted color', () => {
    expect(JSON.parse(buildConfigureMessage({ defaultShapeFillColor: 'none' })).config.defaultVertexStyle)
      .toEqual({ fillColor: 'none' });
    expect(JSON.parse(buildConfigureMessage({ defaultShapeFillColor: ' #F5F5F5 ' })).config.defaultVertexStyle)
      .toEqual({ fillColor: '#F5F5F5' });
  });

  it('parses a save event with xml', () => {
    const parsed = parseDrawioEvent(JSON.stringify({ event: 'save', xml: '<x/>' }));
    expect(parsed).toEqual({ event: 'save', xml: '<x/>' });
  });

  it('returns null for non-drawio / malformed payloads', () => {
    expect(parseDrawioEvent('not json')).toBeNull();
    expect(parseDrawioEvent(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });
});
