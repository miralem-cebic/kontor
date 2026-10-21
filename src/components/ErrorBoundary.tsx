import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';
import { showToast } from '../store/appStore';
import { reportCrash } from '../app/crashReporting';

interface Props {
  /** Shown in the diagnostics, for example "sidebar" or "main" */
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one failing part of the screen from taking down the rest. Shows a short message with
 * "Try again" and "Copy diagnostics"; the other parts keep working.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportCrash(this.props.name, error);
    console.error(info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  private copyDiagnostics = async () => {
    const e = this.state.error;
    const text = JSON.stringify(
      {
        boundary: this.props.name,
        error: e?.name,
        message: e?.message,
        stack: (e?.stack ?? '').split('\n').slice(0, 8).join('\n'),
        time: new Date().toISOString(),
        userAgent: navigator.userAgent,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('crash.copied'));
    } catch {
      showToast(t('crash.copyFailed'));
    }
  };

  render() {
    if (this.state.error) {
      return (
        <div className="crash" role="alert">
          <p className="crash-title">{t('crash.title')}</p>
          <p className="crash-text">{t('crash.text')}</p>
          <div className="crash-actions">
            <button type="button" className="btn" onClick={this.retry}>
              {t('crash.retry')}
            </button>
            <button type="button" className="btn ghost" onClick={this.copyDiagnostics}>
              {t('crash.copy')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
