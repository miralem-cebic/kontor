// Additions to the File System Access API that are still missing from lib.dom (Chromium only).
type FsPermissionMode = 'read' | 'readwrite';

interface FileSystemHandle {
  queryPermission(descriptor?: { mode?: FsPermissionMode }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: FsPermissionMode }): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}

interface Window {
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: FsPermissionMode;
    startIn?: 'desktop' | 'documents' | 'downloads' | FileSystemHandle;
  }): Promise<FileSystemDirectoryHandle>;
}
