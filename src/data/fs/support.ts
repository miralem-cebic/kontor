export interface SupportInfo {
  supported: boolean;
  secureContext: boolean;
  protocol: string;
  hasDirectoryPicker: boolean;
  hasIndexedDb: boolean;
  userAgent: string;
}

export function checkSupport(): SupportInfo {
  const hasDirectoryPicker = typeof window.showDirectoryPicker === 'function';
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  return {
    supported: hasDirectoryPicker && hasIndexedDb && window.isSecureContext,
    secureContext: window.isSecureContext,
    protocol: location.protocol,
    hasDirectoryPicker,
    hasIndexedDb,
    userAgent: navigator.userAgent,
  };
}
