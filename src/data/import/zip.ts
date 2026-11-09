// ZIP reader for the Excel import. The file is untrusted: the reader refuses names that leave the folder (roadmap, "Rules
// for importers"), limits the number of entries, and refuses contents that unpack to more than the limit, before it
// unpacks them, so that a small file cannot fill the memory (a zip bomb). Only stored and deflated entries are read.

import { err, ok, type Result } from '../result';
import { concatBytes, crc32 } from '../export/zip';

export const ZIP_LIMITS = {
  /** An Excel file of a company's lists has a few entries; more is not a workbook we read */
  entries: 100,
  /** All entries together, unpacked: 20 MB */
  unpacked: 20_000_000,
  /**
   * An entry larger than `ratioFrom` that unpacks to more than `ratio` times its packed size is a bomb, not a sheet: the
   * XML of a real workbook packs to about a tenth (#76). A small entry may pack better.
   */
  ratio: 100,
  ratioFrom: 1_000_000,
} as const;

export type ZipProblem = 'invalid' | 'tooManyEntries' | 'tooLarge' | 'unsafeName' | 'unsupported';

const END_RECORD = 22;
const MAX_COMMENT = 65_535;

/** Is the name of an entry a plain relative path inside the file? No "..", no absolute path, no backslash, no drive. */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || name.length > 255 || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split('/');
  return parts.every((part, i) => part !== '..' && (part !== '' || i === parts.length - 1));
}

/** The bytes of a deflated entry, or null when they do not unpack to the declared size (a wrong or a bomb-like file) */
async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array | null> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > expected) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  return size === expected ? concatBytes(parts) : null;
}

/** The entries of a ZIP file by name. A file that is not a ZIP file, or is damaged, is `invalid`. */
export async function readZip(bytes: Uint8Array): Promise<Result<Map<string, Uint8Array>, { kind: ZipProblem }>> {
  if (bytes.length < END_RECORD) return err({ kind: 'invalid' });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - END_RECORD; i >= Math.max(0, bytes.length - END_RECORD - MAX_COMMENT); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return err({ kind: 'invalid' });
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count > ZIP_LIMITS.entries) return err({ kind: 'tooManyEntries' });
  if (centralOffset + centralSize > bytes.length) return err({ kind: 'invalid' });

  const out = new Map<string, Uint8Array>();
  let unpacked = 0;
  let at = centralOffset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return err({ kind: 'invalid' });
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > bytes.length) return err({ kind: 'invalid' });
    const name = new TextDecoder('utf-8').decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) return err({ kind: 'unsupported' }); // encrypted
    if (method !== 0 && method !== 8) return err({ kind: 'unsupported' });
    if (!isSafeEntryName(name)) return err({ kind: 'unsafeName' });
    if (size > ZIP_LIMITS.ratioFrom && size > packedSize * ZIP_LIMITS.ratio) return err({ kind: 'tooLarge' });
    unpacked += size;
    if (unpacked > ZIP_LIMITS.unpacked) return err({ kind: 'tooLarge' });
    if (out.has(name)) return err({ kind: 'invalid' });

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return err({ kind: 'invalid' });
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const dataEnd = dataStart + packedSize;
    if (dataEnd > bytes.length) return err({ kind: 'invalid' });
    const raw = bytes.subarray(dataStart, dataEnd);
    const data = method === 0 ? (raw.length === size ? raw : null) : await inflateRaw(raw, size);
    if (data === null || crc32(data) !== crc) return err({ kind: 'invalid' });
    out.set(name, data);
  }
  return ok(out);
}
