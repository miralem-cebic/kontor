import { t } from '../i18n';
import { showToast } from '../store/appStore';
import { saveEmergencyCopy } from './session';

// Last line of defence for errors that no error boundary catches (event handlers, promises, timers).
// Unsaved edits are kept first, then the user is told. The app keeps running.

export function reportCrash(where: string, error: unknown) {
  saveEmergencyCopy();
  console.error(`Unexpected error (${where})`, error);
  showToast(t('crash.toast'));
}

/** Installs the global handlers; returns the function that removes them. */
export function installCrashHandlers(): () => void {
  const onError = (e: ErrorEvent) => {
    // Errors while loading resources have no `error` object and are not handled here
    if (e.error) reportCrash('window', e.error);
  };
  const onRejection = (e: PromiseRejectionEvent) => reportCrash('promise', e.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
