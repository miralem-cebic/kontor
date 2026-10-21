/**
 * Checks or renews write permission for the data folder.
 * `request` may only return true from a user gesture (click).
 */
export async function ensureReadWrite(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}
