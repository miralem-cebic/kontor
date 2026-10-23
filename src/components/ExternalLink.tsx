import type { ReactNode } from 'react';
import { isWebUrl } from '../domain/links';
import { t } from '../i18n';

/**
 * A link to a page outside kontor, opened in a new window. Only an http: or https: URL becomes an href; anything else
 * is shown as plain text.
 */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!isWebUrl(href)) return <span>{children}</span>;
  return (
    <a className="ext-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> {t('common.newWindow')}</span>
    </a>
  );
}
