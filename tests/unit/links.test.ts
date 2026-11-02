import { describe, expect, it } from 'vitest';
import { TRADE_TAX_MULTIPLIER_SOURCE } from '../../src/domain/company';
import { isWebUrl, MAILTO_MAX_LENGTH, mailtoHref } from '../../src/domain/links';

describe('isWebUrl', () => {
  it('accepts absolute http and https URLs', () => {
    expect(isWebUrl('https://www.statistikportal.de/de/karte-hebesaetze')).toBe(true);
    expect(isWebUrl('http://example.com')).toBe(true);
    expect(isWebUrl('HTTPS://EXAMPLE.COM/a?b=c#d')).toBe(true);
  });

  it.each(['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/Users', 'mailto:a@b.de', '/relative/path', 'www.example.com', '', 'https://'])(
    'refuses %j',
    (url) => {
      expect(isWebUrl(url)).toBe(false);
    },
  );

  it('the source of the trade tax multipliers is an https link', () => {
    expect(TRADE_TAX_MULTIPLIER_SOURCE.startsWith('https://')).toBe(true);
    expect(isWebUrl(TRADE_TAX_MULTIPLIER_SOURCE)).toBe(true);
  });
});

describe('mailtoHref (the one exception to the href rule, see CLAUDE.md)', () => {
  it('builds a mailto: link with the address, subject and text, every part percent-encoded', () => {
    expect(mailtoHref('einkauf@kunde.example', 'Rechnung RE 1', 'Zeile 1\r\nZeile 2 & 3')).toEqual({
      href: 'mailto:einkauf%40kunde.example?subject=Rechnung%20RE%201&body=Zeile%201%0D%0AZeile%202%20%26%203',
      bodyIncluded: true,
    });
  });

  it('refuses an address that is not one, so nothing is built from it', () => {
    expect(mailtoHref('kein-mail', 'Betreff', 'Text')).toBeNull();
    expect(mailtoHref('', 'Betreff', 'Text')).toBeNull();
  });

  it('cannot take a further parameter through the address: its "?" is encoded, so the only "?" is the one before the subject', () => {
    const link = mailtoHref('a@b.de?subject=Ha', 'Betreff', 'Text');
    expect(link?.href.split('?')[0]).toBe('mailto:a%40b.de%3Fsubject%3DHa');
    expect(link?.href.split('?')).toHaveLength(2);
  });

  it('leaves the text out when the link would be too long, and keeps the subject', () => {
    const link = mailtoHref('einkauf@kunde.example', 'Rechnung', 'x'.repeat(MAILTO_MAX_LENGTH));
    expect(link).toEqual({ href: 'mailto:einkauf%40kunde.example?subject=Rechnung', bodyIncluded: false });
  });

  it('is not taken for a web link', () => {
    const link = mailtoHref('einkauf@kunde.example', 'Rechnung', 'Text');
    expect(link && isWebUrl(link.href)).toBe(false);
  });
});
