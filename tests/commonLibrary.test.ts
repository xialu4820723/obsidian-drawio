import { describe, it, expect } from 'vitest';
import { parseCommonLibrary } from '../src/model/commonLibrary';

describe('parseCommonLibrary', () => {
  it.each([
    {}, null, [], [null], ['shape'], [{}],
    [{ xml: 'x', w: '100', h: 40 }], [{ xml: 'x', w: 100, h: -1 }],
    [{ xml: 'x', w: 100 }], [{ xml: '', w: 1, h: 1 }],
    [{ xml: 42, data: 'image', w: 1, h: 1 }],
    [{ data: {}, w: 1, h: 1 }], [{ xml: 'x', w: 1, h: 1, title: 42 }],
  ].map((data) => [data]))('rejects empty or structurally invalid native entry data: %j', (data) => {
    expect(() => parseCommonLibrary(`<mxlibrary>${JSON.stringify(data)}</mxlibrary>`)).toThrow();
  });
  it('parses native mxlibrary text and preserves compressed XML and native extension fields', () => {
    const entries = [
      { xml: '<mxGraphModel><root/></mxGraphModel>', w: 120, h: 60, title: '模块', aspect: 'fixed' },
      { xml: 'compressed+base64==', w: 100, h: 0, custom: { retained: true } },
      { data: 'data:image/png;base64,AA==', w: 20, h: 20 },
    ];
    const text = JSON.stringify(entries).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(parseCommonLibrary(`<?xml version="1.0"?><mxlibrary>${text}</mxlibrary>`)).toEqual(entries);
  });

  it.each([
    '<library>[{"xml":"x","w":1,"h":1}]</library>',
    '<!DOCTYPE mxlibrary><mxlibrary>[{"xml":"x","w":1,"h":1}]</mxlibrary>',
    '<!DOCTYPE mxlibrary [<!ENTITY shape "x">]><mxlibrary>[{"xml":"&shape;","w":1,"h":1}]</mxlibrary>',
    '<mxlibrary>not JSON</mxlibrary>',
    '<mxlibrary><unexpected/>[{"xml":"x","w":1,"h":1}]</mxlibrary>',
    '<mxlibrary>[{"xml":"x","w":1,"h":1}]',
  ])('rejects non-native or malformed XML: %s', (xml) => {
    expect(() => parseCommonLibrary(xml)).toThrow();
  });
});
