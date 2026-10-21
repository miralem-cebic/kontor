/** Writes JSON (pretty-printed, trailing newline) and returns the file's new lastModified. */
export const writeJson = (dir: FileSystemDirectoryHandle, name: string, data: unknown): Promise<number> =>
  writeFile(dir, name, JSON.stringify(data, null, 2) + '\n');

/** Writes a file in one go: the browser writes to a temporary file and replaces the target on close. */
export async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: string | Blob): Promise<number> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(data);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => undefined);
    throw e;
  }
  return (await fh.getFile()).lastModified;
}
