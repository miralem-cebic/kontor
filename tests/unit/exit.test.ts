import { describe, expect, it, vi } from 'vitest';
import { ARCHIVE_LIMITS, archiveTooLarge, exitArchive, isSafeArchivePath, type ArchiveFile } from '../../src/data/export/exit';
import { readZip, ZIP_LIMITS } from '../../src/data/import/zip';
import { writeZip } from '../../src/data/export/zip';

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const file = (path: string, text: string): ArchiveFile => ({ path, size: enc(text).length, read: async () => enc(text) });
const bytesOf = async (entry: { data: Uint8Array } | { read: () => Promise<Uint8Array> }) => ('data' in entry ? entry.data : entry.read());

describe('exitArchive', () => {
  const folder = [file('company.json', '{"name":"Muster"}'), file('belege/2026/x.pdf', '%PDF-1.4')];
  const lists = [{ name: 'contacts', header: ['Name', 'Ort'], rows: [['Müller', 'Köln']] }];
  const readme = (skipped: readonly string[]) => (skipped.length ? `Lies mich. Ausgelassen: ${skipped.join(', ')}` : 'Lies mich');

  it('keeps the folder as it is, adds every list as a CSV file under listen/ and a readme', async () => {
    const { entries, skipped } = exitArchive(folder, lists, readme);
    expect(skipped).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(['company.json', 'belege/2026/x.pdf', 'listen/contacts.csv', 'LIESMICH.txt']);
    expect(dec(await bytesOf(entries[0]!))).toBe('{"name":"Muster"}');
    expect((await bytesOf(entries[2]!)).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(dec(await bytesOf(entries[2]!))).toBe('Name;Ort\r\nMüller;Köln\r\n');
    expect(dec(await bytesOf(entries[3]!))).toBe('Lies mich');
  });

  it('reads back from the ZIP file with the same names and contents', async () => {
    const zip = await writeZip(exitArchive(folder, lists, readme).entries);
    const r = await readZip(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.value.keys()]).toEqual(['company.json', 'belege/2026/x.pdf', 'listen/contacts.csv', 'LIESMICH.txt']);
    expect(dec(r.value.get('belege/2026/x.pdf')!)).toBe('%PDF-1.4');
  });

  it('leaves out a file whose name a ZIP tool could read as a path, and names it in the readme (#80)', async () => {
    const unsafe = ['belege/..\\..\\Startup\\x.bat', 'belege/C:x.pdf', 'belege/a\u0007b.pdf', 'belege/../x.pdf', 'belege/ x.pdf'];
    const { entries, skipped } = exitArchive([...folder, ...unsafe.map((p) => file(p, 'x'))], lists, readme);
    expect(skipped).toEqual(unsafe);
    expect(entries.map((e) => e.name)).toEqual(['company.json', 'belege/2026/x.pdf', 'listen/contacts.csv', 'LIESMICH.txt']);
    expect(dec(await bytesOf(entries[3]!))).toContain('belege/..\\..\\Startup\\x.bat');
    // and the archive reads back: the reader would refuse a file with an unsafe entry
    expect((await readZip(await writeZip(entries))).ok).toBe(true);
  });

  it('reads each file only while the archive is written, one after the other (#80)', async () => {
    const order: string[] = [];
    const lazy = (path: string): ArchiveFile => ({ path, size: 1, read: vi.fn(async () => (order.push(path), enc('x'))) });
    const { entries } = exitArchive([lazy('a.json'), lazy('b.json')], [], readme);
    expect(order).toEqual([]);
    await writeZip(entries);
    expect(order).toEqual(['a.json', 'b.json']);
  });

  it('is far below the limit of what the reader takes back', () => {
    expect(ZIP_LIMITS.entries).toBeGreaterThan(exitArchive(folder, lists, readme).entries.length);
  });
});

describe('isSafeArchivePath', () => {
  it('takes the paths of a company folder, and no path a ZIP tool could take as a separator, a drive or a step up', () => {
    for (const ok of ['company.json', 'belege/2026/1b4e28ba-2fa1-41d2-883f-0016d3cca427-Rechnung März.pdf', 'documents/issued/RE-2026-0001.pdf']) expect(isSafeArchivePath(ok), ok).toBe(true);
    for (const bad of ['', '/etc/x', 'a\\b', 'C:/x', 'a/../b', 'a//b', 'a/b:c', 'a/b?', 'a/ b', 'x'.repeat(256)]) expect(isSafeArchivePath(bad), bad).toBe(false);
  });
});

describe('archiveTooLarge', () => {
  it('a folder with more files or bytes than a ZIP file without ZIP64 holds, made in memory, is refused before it is read', () => {
    const many = (n: number, size: number): ArchiveFile[] => Array.from({ length: n }, (_, i) => ({ path: `f${i}`, size, read: async () => new Uint8Array() }));
    expect(archiveTooLarge(many(10, 1_000))).toBe(false);
    expect(archiveTooLarge(many(ARCHIVE_LIMITS.files + 1, 1))).toBe(true);
    expect(archiveTooLarge(many(2, ARCHIVE_LIMITS.bytes / 2 + 1))).toBe(true);
  });
});
