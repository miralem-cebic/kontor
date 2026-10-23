import { describe, expect, it } from 'vitest';
import { TRADE_TAX_MULTIPLIER_SOURCE } from '../../src/domain/company';
import { isWebUrl } from '../../src/domain/links';

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
