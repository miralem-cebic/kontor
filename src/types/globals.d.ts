// Hooks of the ?e2e test mode (see DEVELOPMENT.md). They are set only when the URL contains `e2e`.
export {};

declare global {
  interface Window {
    __e2e?: {
      /** Waits until pending writes are done */
      flush: () => unknown;
      /** The next simulated folder picker returns the folder with this name (created when new) */
      nextFolder: (name: string) => void;
    };
  }
}
