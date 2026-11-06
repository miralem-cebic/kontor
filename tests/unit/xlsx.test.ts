import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { date, num } from '../../src/data/export/csv';
import { tableToXlsx } from '../../src/data/export/xlsx';
import { writeZip } from '../../src/data/export/zip';
import { readXlsx } from '../../src/data/import/xlsx';
import { parseXml, escapeXml, XML_LIMITS } from '../../src/data/import/xml';
import { readZip, ZIP_LIMITS } from '../../src/data/import/zip';
import { fcParams as params } from './fixtures';

const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('zip', () => {
  it('writes entries that read back with their names and contents', async () => {
    const zip = await writeZip([
      { name: 'a.txt', data: bytesOf('hallo Müller') },
      { name: 'xl/worksheets/sheet1.xml', data: bytesOf('<x/>') },
    ]);
    const r = await readZip(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(textOf(r.value.get('a.txt')!)).toBe('hallo Müller');
    expect(textOf(r.value.get('xl/worksheets/sheet1.xml')!)).toBe('<x/>');
  });

  it('refuses a name that leaves the folder, is absolute or uses a backslash', async () => {
    for (const name of ['../evil.txt', '/abs.txt', 'a\\b.txt', 'a/../../b.txt']) {
      const r = await readZip(await writeZip([{ name, data: bytesOf('x') }]));
      expect(r, name).toEqual({ ok: false, error: { kind: 'unsafeName' } });
    }
  });

  it('refuses more entries than the limit', async () => {
    const entries = Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({ name: `f${i}.txt`, data: bytesOf('x') }));
    expect(await readZip(await writeZip(entries))).toEqual({ ok: false, error: { kind: 'tooManyEntries' } });
  });

  it('refuses contents that unpack to more than the limit, a zip bomb, however small the file is', async () => {
    const zip = await writeZip([{ name: 'bomb.xml', data: new Uint8Array(ZIP_LIMITS.unpacked + 1) }]);
    expect(zip.length).toBeLessThan(ZIP_LIMITS.unpacked / 100);
    expect(await readZip(zip)).toEqual({ ok: false, error: { kind: 'tooLarge' } });
  });

  it('refuses a file that is not a zip', async () => {
    expect(await readZip(bytesOf('das ist kein Excel'))).toEqual({ ok: false, error: { kind: 'invalid' } });
  });
});

describe('xml', () => {
  it('reads elements, attributes, entities and character references; a comment and the declaration are skipped', () => {
    const r = parseXml('<?xml version="1.0" encoding="UTF-8"?><!-- c --><a x="1 &amp; 2"><b>Müller &lt;Co&gt; &#65;&#x42;</b><c/></a>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('a');
    expect(r.value.attrs['x']).toBe('1 & 2');
    expect(r.value.children.map((c) => (typeof c === 'string' ? c : c.name))).toEqual(['b', 'c']);
    const b = r.value.children[0];
    expect(typeof b === 'object' && b.children).toEqual(['Müller <Co> AB']);
  });

  it('refuses a document type declaration, so that no entity is defined by the file', () => {
    expect(parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toEqual({ ok: false, error: { kind: 'unsupported' } });
  });

  it('refuses nesting deeper than the limit', () => {
    const deep = '<a>'.repeat(XML_LIMITS.depth + 1) + '</a>'.repeat(XML_LIMITS.depth + 1);
    expect(parseXml(deep)).toEqual({ ok: false, error: { kind: 'tooDeep' } });
  });

  // the text of an XML document: no control character that XML cannot hold, and no lone surrogate
  const text = fc.string({ maxLength: 60 }).filter((s) => [...s].every((ch) => ch.charCodeAt(0) >= 0x20 || ch === '\t' || ch === '\n' || ch === '\r'));
  it('reads back any text that escapeXml wrote (property)', () => {
    fc.assert(
      fc.property(text, (s) => {
        const r = parseXml(`<t>${escapeXml(s)}</t>`);
        expect(r.ok && r.value.children.join('')).toBe(s);
      }),
      params,
    );
  });
});

describe('xlsx', () => {
  it('writes a sheet that reads back: text as text, numbers as decimal points, dates as serial numbers', async () => {
    const bytes = await tableToXlsx({
      header: ['Name', 'Betrag', 'Datum'],
      rows: [
        ['Telekom', num('49,99'), date('2026-10-28')],
        ['=Summe', num('-12,50'), ''],
      ],
    });
    const r = await readXlsx(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serial = String((Date.UTC(2026, 9, 28) - Date.UTC(1899, 11, 30)) / 86_400_000);
    expect(r.value.rows).toEqual([
      ['Name', 'Betrag', 'Datum'],
      ['Telekom', { number: '49.99' }, { number: serial }],
      ['=Summe', { number: '-12.5' }, ''],
    ]);
  });

  it('reads a sheet that Excel wrote with shared strings', async () => {
    const workbook = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Kontakte" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>';
    const shared = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si><si><r><t>Kunde </t></r><r><t>GmbH</t></r></si></sst>';
    const sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>7</v></c></row></sheetData></worksheet>';
    const zip = await writeZip([
      { name: 'xl/workbook.xml', data: bytesOf(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: bytesOf(rels) },
      { name: 'xl/sharedStrings.xml', data: bytesOf(shared) },
      { name: 'xl/worksheets/sheet1.xml', data: bytesOf(sheet) },
    ]);
    const r = await readXlsx(zip);
    expect(r.ok && r.value.rows).toEqual([['Name'], ['Kunde GmbH', '', { number: '7' }]]);
  });

  it('refuses a file that is not a workbook', async () => {
    expect(await readXlsx(bytesOf('kein Excel'))).toEqual({ ok: false, error: { kind: 'invalid' } });
  });
});
