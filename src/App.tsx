import { useEffect } from 'react';
import { installCrashHandlers } from './app/crashReporting';
import { boot, useSession } from './app/session';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './components/Toast';
import { SetupWizard } from './features/setup/SetupWizard';
import { Shell } from './features/shell/Shell';
import { StartScreen } from './features/start/StartScreen';
import { currentLang } from './i18n';
import { usePrefs } from './store/prefs';

export function App() {
  const phase = useSession((s) => s.phase);
  // Re-renders the whole tree on a language change, so that every text is translated again
  const lang = usePrefs((s) => s.language);
  useEffect(() => {
    void boot();
    return installCrashHandlers();
  }, []);
  useEffect(() => {
    document.documentElement.lang = currentLang();
  }, [lang]);
  // Last resort: a crash outside every boundary below still shows a way back
  return (
    <ErrorBoundary name="app">
      {phase === 'ready' ? <Shell /> : phase === 'setup' ? <SetupWizard /> : <StartScreen />}
      <ToastHost />
    </ErrorBoundary>
  );
}
