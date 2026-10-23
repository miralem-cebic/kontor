import { useState } from 'react';
import { retrySave } from '../../app/session';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Icon, type IconName } from '../../components/Icon';
import type { DocumentId } from '../../data/ids';
import { t, type MessageKey } from '../../i18n';
import { errorText } from '../../lib/labels';
import { useApp } from '../../store/appStore';
import { ContactsView } from '../contacts/ContactsView';
import { HomeView } from '../home/HomeView';
import { InvoicesView } from '../invoices/InvoicesView';
import { ItemsView } from '../items/ItemsView';
import { QuotesView } from '../quotes/QuotesView';
import { SettingsView } from '../settings/SettingsView';
import { CompanySwitcher } from './CompanySwitcher';

// The app frame: navigation on the left, the selected area on the right.
// Areas that come in later phases are listed, but disabled.

type View = 'home' | 'quotes' | 'invoices' | 'contacts' | 'items' | 'settings';

const AREAS: { key: MessageKey; icon: IconName; view?: View }[] = [
  { key: 'nav.dashboard', icon: 'home', view: 'home' },
  { key: 'nav.quotes', icon: 'quote', view: 'quotes' },
  { key: 'nav.invoices', icon: 'invoice', view: 'invoices' },
  { key: 'nav.expenses', icon: 'expense' },
  { key: 'nav.contacts', icon: 'contacts', view: 'contacts' },
  { key: 'nav.items', icon: 'item', view: 'items' },
  { key: 'nav.taxes', icon: 'tax' },
  { key: 'nav.tools', icon: 'tools' },
  { key: 'nav.settings', icon: 'settings', view: 'settings' },
];

export function Shell() {
  const [view, setView] = useState<View>('home');
  // "Create invoice" in a quote: the invoices open with a new invoice for it
  const [fromQuote, setFromQuote] = useState<DocumentId | null>(null);
  const open = (next: View) => {
    setFromQuote(null);
    setView(next);
  };
  const createInvoice = (quoteId: DocumentId) => {
    setFromQuote(quoteId);
    setView('invoices');
  };
  return (
    <div className="app">
      <ErrorBoundary name="sidebar">
        <nav className="side" aria-label={t('nav.label')}>
          <CompanySwitcher />
          <ul className="nav-list">
            {AREAS.map((a) => (
              <li key={a.key}>
                {a.view ? (
                  <button type="button" className={'nav' + (view === a.view ? ' on' : '')} aria-current={view === a.view ? 'page' : undefined} onClick={() => a.view && open(a.view)}>
                    <Icon n={a.icon} />
                    <span>{t(a.key)}</span>
                  </button>
                ) : (
                  <button type="button" className="nav" disabled aria-describedby="nav-soon">
                    <Icon n={a.icon} />
                    <span>{t(a.key)}</span>
                    <small className="soon">{t('nav.soon')}</small>
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p id="nav-soon" className="visually-hidden">
            {t('nav.soonHint')}
          </p>
          <div className="sp" />
          <SaveStatus />
        </nav>
      </ErrorBoundary>
      <main className="main">
        <ErrorBoundary name="main">
          <MainView view={view} fromQuote={fromQuote} onCreateInvoice={createInvoice} />
        </ErrorBoundary>
      </main>
    </div>
  );
}

function MainView({ view, fromQuote, onCreateInvoice }: { view: View; fromQuote: DocumentId | null; onCreateInvoice: (quoteId: DocumentId) => void }) {
  switch (view) {
    case 'home':
      return <HomeView />;
    case 'quotes':
      return <QuotesView onCreateInvoice={onCreateInvoice} />;
    case 'invoices':
      // a new key for every quote, so that the view starts again with its new invoice
      return <InvoicesView key={fromQuote ?? 'list'} fromQuote={fromQuote} />;
    case 'contacts':
      return <ContactsView />;
    case 'items':
      return <ItemsView />;
    case 'settings':
      return <SettingsView />;
  }
}

function SaveStatus() {
  const save = useApp((s) => s.save);
  if (save.state === 'error') {
    return (
      <div className="save error" role="alert">
        <Icon n="alert" s={14} />
        <span>{t('save.failed', { reason: errorText(save.kind) })}</span>
        <button type="button" className="btn sm" onClick={() => void retrySave()}>
          {t('save.retry')}
        </button>
      </div>
    );
  }
  return (
    <div className="save" role="status">
      {save.state === 'saving' ? t('save.saving') : t('save.saved')}
    </div>
  );
}
