// A small XML reader for the parts of a spreadsheet the importer needs: elements, attributes, text, entities and character
// references, comments and the declaration. It refuses what it does not need and what is dangerous: a document type
// declaration (it could define entities), and nesting deeper than the limit. Text is decoded; nothing is fetched.

import { err, ok, type Result } from '../result';

export const XML_LIMITS = {
  /** Spreadsheets nest a few levels; sixty-four is far more than any sheet, and stops a file that nests on purpose */
  depth: 64,
} as const;

export interface XmlElement {
  /** The name as written, with its prefix ("x:row") */
  name: string;
  /** The attributes by their names as written ("r:id") */
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

export type XmlProblem = 'invalid' | 'unsupported' | 'tooDeep';

class XmlError extends Error {
  constructor(readonly kind: XmlProblem) {
    super(kind);
  }
}

const NAME = /[A-Za-z_:][A-Za-z0-9_:.-]*/y;
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The text with its entities and character references replaced; an unknown entity stays as it is */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return codePoint(parseInt(body.slice(2), 16), whole);
    if (body.startsWith('#')) return codePoint(parseInt(body.slice(1), 10), whole);
    return ENTITIES[body] ?? whole;
  });
}

function codePoint(value: number, whole: string): string {
  return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
}

/** XML 1.0 holds tab, line feed and carriage return among the control characters, and no other one */
const isXmlChar = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
};

/** Text as an XML document can hold it: control characters that XML cannot hold are dropped, the rest is escaped, and a carriage return is written as a reference so it is kept */
export function escapeXml(text: string): string {
  return [...text]
    .filter(isXmlChar)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;');
}

/** The document: its root element. Errors are results, so the importer can say what is wrong with the file. */
export function parseXml(text: string): Result<XmlElement, { kind: XmlProblem }> {
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const skipProlog = () => {
    for (;;) {
      while (at < text.length && /\s/.test(text.charAt(at))) at++;
      if (text.startsWith('<?', at)) at = endOf('?>', at);
      else if (text.startsWith('<!--', at)) at = endOf('-->', at);
      else if (text.startsWith('<!', at)) throw new XmlError('unsupported');
      else return;
    }
  };

  const endOf = (close: string, from: number): number => {
    const found = text.indexOf(close, from);
    if (found < 0) throw new XmlError('invalid');
    return found + close.length;
  };

  const name = (): string => {
    NAME.lastIndex = at;
    const m = NAME.exec(text);
    if (!m) throw new XmlError('invalid');
    at = NAME.lastIndex;
    return m[0];
  };

  const element = (depth: number): XmlElement => {
    if (depth > XML_LIMITS.depth) throw new XmlError('tooDeep');
    at++; // the "<"
    const elementName = name();
    const attrs: Record<string, string> = Object.create(null);
    for (;;) {
      while (at < text.length && /\s/.test(text.charAt(at))) at++;
      if (text.startsWith('/>', at)) {
        at += 2;
        return { name: elementName, attrs, children: [] };
      }
      if (text.charAt(at) === '>') {
        at++;
        break;
      }
      const attr = name();
      while (at < text.length && /\s/.test(text.charAt(at))) at++;
      if (text.charAt(at) !== '=') throw new XmlError('invalid');
      at++;
      while (at < text.length && /\s/.test(text.charAt(at))) at++;
      const quote = text.charAt(at);
      if (quote !== '"' && quote !== "'") throw new XmlError('invalid');
      const close = text.indexOf(quote, at + 1);
      if (close < 0) throw new XmlError('invalid');
      attrs[attr] = decode(text.slice(at + 1, close));
      at = close + 1;
    }

    const children: (XmlElement | string)[] = [];
    for (;;) {
      if (at >= text.length) throw new XmlError('invalid');
      if (text.startsWith('</', at)) {
        at += 2;
        const closing = name();
        while (at < text.length && /\s/.test(text.charAt(at))) at++;
        if (closing !== elementName || text.charAt(at) !== '>') throw new XmlError('invalid');
        at++;
        return { name: elementName, attrs, children };
      }
      if (text.startsWith('<!--', at)) at = endOf('-->', at);
      else if (text.startsWith('<![CDATA[', at)) {
        const close = endOf(']]>', at);
        children.push(text.slice(at + 9, close - 3));
        at = close;
      } else if (text.startsWith('<?', at)) at = endOf('?>', at);
      else if (text.startsWith('<!', at)) throw new XmlError('unsupported');
      else if (text.charAt(at) === '<') children.push(element(depth + 1));
      else {
        const next = text.indexOf('<', at);
        const end = next < 0 ? text.length : next;
        children.push(decode(text.slice(at, end)));
        at = end;
      }
    }
  };

  try {
    skipProlog();
    if (text.charAt(at) !== '<') throw new XmlError('invalid');
    const root = element(1);
    skipProlog();
    if (at < text.length) throw new XmlError('invalid');
    return ok(root);
  } catch (e) {
    if (e instanceof XmlError) return err({ kind: e.kind });
    throw e;
  }
}
