// The test mode of the e2e tests (see DEVELOPMENT.md): the flag that switches it on, and its hooks, which are set only
// in test mode.
export {};

declare global {
  interface Window {
    /** Set by the Playwright setup before the app's script runs (addInitScript); nothing else switches the test mode on */
    __kontorE2E?: boolean;
    __e2e?: {
      /** Waits until pending writes are done */
      flush: () => unknown;
      /** The next simulated folder picker returns the folder with this name (created when new) */
      nextFolder: (name: string) => void;
    };
  }
}
