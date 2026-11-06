import { describe, expect, it } from 'vitest';
import { exitArchive } from '../../src/data/export/exit';
import { readZip, ZIP_LIMITS } from '../../src/data/import/zip';
import { writeZip } from '../../src/data/export/zip';

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('exitArchive', () => {
  const folder = [
    { path: 'company.json', data: enc('{"name":"Muster"}') },
    { path: 'belege/2026/x.pdf', data: enc('%PDF-1.4') },
  ];
  const lists = [{ name: 'contacts', header: ['Name', 'Ort'], rows: [['Müller', 'Köln']] }];

  it('keeps the folder as it is, adds every list as a CSV file under listen/ and a readme', () => {
    const entries = exitArchive(folder, lists, 'Lies mich');
    expect(entries.map((e) => e.name)).toEqual(['company.json', 'belege/2026/x.pdf', 'listen/contacts.csv', 'LIESMICH.txt']);
    expect(dec(entries[0]!.data)).toBe('{"name":"Muster"}');
    expect(entries[2]!.data.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(dec(entries[2]!.data)).toBe('Name;Ort\r\nMüller;Köln\r\n');
    expect(dec(entries[3]!.data)).toBe('Lies mich');
  });

  it('reads back from the ZIP file with the same names and contents', async () => {
    const zip = await writeZip(exitArchive(folder, lists, 'Lies mich'));
    const r = await readZip(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.value.keys()]).toEqual(['company.json', 'belege/2026/x.pdf', 'listen/contacts.csv', 'LIESMICH.txt']);
    expect(dec(r.value.get('belege/2026/x.pdf')!)).toBe('%PDF-1.4');
  });

  it('is far below the limit of what the reader takes back', () => {
    expect(ZIP_LIMITS.entries).toBeGreaterThan(exitArchive(folder, lists, '').length);
  });
});
