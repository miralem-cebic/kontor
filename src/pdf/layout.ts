// Where everything goes on the page: an A4 business letter after DIN 5008 form B (address field for a window
// envelope, information block on the right, fold and hole marks), the lines as a table that continues on the next
// page with its header repeated, and a footer on every page. Pure: the width of a text comes from `Metrics`, so the
// layout can be tested without a PDF. Coordinates are points from the top left corner; y of a text is its baseline.

import type { DocumentContent, TableRow } from './content';

export type FontKind = 'regular' | 'bold';
export type Tone = 'text' | 'muted' | 'rule' | 'watermark';

export interface TextItem {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  font: FontKind;
  tone: Tone;
}

export interface RuleItem {
  kind: 'rule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  tone: Tone;
}

/** The box the logo is fitted into, keeping its proportions; y is the top of the box */
export interface LogoItem {
  kind: 'logo';
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Large text across the middle of the page, drawn under everything else */
export interface WatermarkItem {
  kind: 'watermark';
  text: string;
  size: number;
}

export type Item = TextItem | RuleItem | LogoItem | WatermarkItem;

export interface Page {
  items: Item[];
}

export interface Layout {
  width: number;
  height: number;
  pages: Page[];
}

export interface Metrics {
  /** Width of a text in points */
  width(text: string, font: FontKind, size: number): number;
}

/** Points per millimetre */
export const MM = 72 / 25.4;
export const PAGE = { width: 210 * MM, height: 297 * MM };

const LEFT = 25 * MM;
const RIGHT = 190 * MM;
/** Top of a line to its baseline, and the distance between lines, as a share of the font size */
const ASCENT = 0.97;
const LEADING = 1.3;

const SIZE = { letterhead: 14, sender: 7, address: 10, info: 8.5, title: 15, subject: 11, body: 10, table: 9, description: 8, total: 9.5, grand: 10.5, footer: 7, head: 7.5 } as const;

const lineHeight = (size: number) => size * LEADING;

/**
 * Breaks a text into lines no wider than `maxWidth`. Line breaks in the text are kept; a word wider than a line is
 * broken between characters.
 */
export function wrap(text: string, maxWidth: number, font: FontKind, size: number, m: Metrics): string[] {
  if (text.trim() === '') return [];
  const fits = (s: string) => m.width(s, font, size) <= maxWidth;
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ').filter((w) => w !== '')) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      let rest = [...word];
      while (rest.length > 1 && !fits(rest.join(''))) {
        let n = rest.length - 1;
        while (n > 1 && !fits(rest.slice(0, n).join(''))) n--;
        out.push(rest.slice(0, n).join(''));
        rest = rest.slice(n);
      }
      line = rest.join('');
    }
    out.push(line);
  }
  return out;
}

interface Column {
  key: keyof Omit<TableRow, 'description'>;
  /** Width in points; the name column takes what the others leave */
  width: number;
  align: 'left' | 'right';
}

const COLUMN_GAP = 2.5 * MM;

function columns(showRate: boolean): { col: Column; x: number }[] {
  const fixed: Column[] = [
    { key: 'pos', width: 9 * MM, align: 'left' },
    { key: 'name', width: 0, align: 'left' },
    { key: 'quantity', width: 16 * MM, align: 'right' },
    { key: 'unit', width: 21 * MM, align: 'left' },
    { key: 'price', width: 24 * MM, align: 'right' },
    ...(showRate ? [{ key: 'rate', width: 12 * MM, align: 'right' } as const] : []),
    { key: 'total', width: 25 * MM, align: 'right' },
  ];
  const taken = fixed.reduce((sum, c) => sum + c.width, 0);
  const name = RIGHT - LEFT - taken;
  let x = LEFT;
  return fixed.map((c) => {
    const col = c.key === 'name' ? { ...c, width: name } : c;
    const placed = { col, x };
    x += col.width;
    return placed;
  });
}

/** Text placed in a column: left aligned at its start, right aligned at its end (minus the gap to the next column) */
function cellX(text: string, col: Column, x: number, font: FontKind, size: number, m: Metrics): number {
  return col.align === 'left' ? x : x + col.width - m.width(text, font, size) - (col.key === 'total' ? 0 : COLUMN_GAP);
}

class Flow {
  readonly pages: Page[] = [];
  y = 0;

  constructor(
    private readonly content: DocumentContent,
    private readonly m: Metrics,
    private readonly bottom: number,
    private readonly onNewPage: () => void,
  ) {}

  get page(): Page {
    const page = this.pages[this.pages.length - 1];
    if (!page) throw new Error('No page yet');
    return page;
  }

  add(item: Item) {
    this.page.items.push(item);
  }

  text(x: number, text: string, size: number, font: FontKind = 'regular', tone: Tone = 'text') {
    this.add({ kind: 'text', x, y: this.y + size * ASCENT, text, size, font, tone });
  }

  start(firstTop: number) {
    this.pages.push({ items: this.watermark() });
    this.y = firstTop;
  }

  /** A following page: the running head, then the body from the top */
  newPage() {
    this.pages.push({ items: this.watermark() });
    this.y = 15 * MM - SIZE.head * ASCENT;
    this.text(LEFT, this.content.runningHead, SIZE.head, 'regular', 'muted');
    this.add({ kind: 'rule', x1: LEFT, y1: 17 * MM, x2: RIGHT, y2: 17 * MM, width: 0.4, tone: 'rule' });
    this.y = 22 * MM;
    this.onNewPage();
  }

  /** Room for `height` on this page, or a new page */
  ensure(height: number) {
    if (this.y + height > this.bottom) this.newPage();
  }

  get room(): number {
    return this.bottom - this.y;
  }

  /** A paragraph that may break between its lines */
  paragraph(text: string, size: number, font: FontKind = 'regular', tone: Tone = 'text', after = 3 * MM) {
    const lines = wrap(text, RIGHT - LEFT, font, size, this.m);
    if (lines.length === 0) return;
    for (const line of lines) {
      this.ensure(lineHeight(size));
      this.text(LEFT, line, size, font, tone);
      this.y += lineHeight(size);
    }
    this.y += after;
  }

  private watermark(): Item[] {
    return this.content.watermark ? [{ kind: 'watermark', text: this.content.watermark, size: 110 }] : [];
  }
}

/** The first page above the body: letterhead, logo, return address, recipient, information block, fold marks */
function firstPage(c: DocumentContent, m: Metrics, logo: boolean): { items: Item[]; bottom: number } {
  const items: Item[] = [];
  const text = (x: number, y: number, t: string, size: number, font: FontKind = 'regular', tone: Tone = 'text') =>
    items.push({ kind: 'text', x, y, text: t, size, font, tone });

  text(LEFT, 22 * MM, c.letterhead, SIZE.letterhead, 'bold');
  if (logo) items.push({ kind: 'logo', x: 135 * MM, y: 10 * MM, width: 55 * MM, height: 24 * MM });

  // address field of form B: from 45 mm, the return address at the end of its upper zone, the address from 62.7 mm
  const addressWidth = 80 * MM;
  const sender = wrap(c.senderLine, addressWidth, 'regular', SIZE.sender, m)[0] ?? '';
  text(LEFT, 58 * MM, sender, SIZE.sender, 'regular', 'muted');
  items.push({ kind: 'rule', x1: LEFT, y1: 59 * MM, x2: LEFT + Math.min(addressWidth, m.width(sender, 'regular', SIZE.sender)), y2: 59 * MM, width: 0.3, tone: 'muted' });
  let y = 62.7 * MM;
  for (const line of c.recipient.flatMap((l) => wrap(l, addressWidth, 'regular', SIZE.address, m))) {
    text(LEFT, y + SIZE.address * ASCENT, line, SIZE.address);
    y += lineHeight(SIZE.address);
  }
  const addressBottom = y;

  // information block: from 125 mm, 75 mm wide
  const labelX = 125 * MM;
  const valueX = 156 * MM;
  const valueWidth = 200 * MM - valueX;
  y = 50 * MM;
  for (const row of c.info) {
    const labels = wrap(row.label, valueX - labelX - 2 * MM, 'regular', SIZE.info, m);
    const values = wrap(row.value, valueWidth, 'regular', SIZE.info, m);
    labels.forEach((l, i) => text(labelX, y + SIZE.info * ASCENT + i * lineHeight(SIZE.info), l, SIZE.info, 'regular', 'muted'));
    values.forEach((v, i) => text(valueX, y + SIZE.info * ASCENT + i * lineHeight(SIZE.info), v, SIZE.info));
    y += Math.max(labels.length, values.length, 1) * lineHeight(SIZE.info) + 0.8 * MM;
  }
  const infoBottom = y;

  // fold marks at 105 and 210 mm, the hole mark at 148.5 mm
  for (const [at, length] of [
    [105, 5],
    [148.5, 8],
    [210, 5],
  ] as const) {
    items.push({ kind: 'rule', x1: 4 * MM, y1: at * MM, x2: (4 + length) * MM, y2: at * MM, width: 0.4, tone: 'rule' });
  }
  return { items, bottom: Math.max(98.5 * MM, addressBottom + 8 * MM, infoBottom + 8 * MM) };
}

/**
 * The columns of the footer side by side. When they fit, each is as wide as its longest line and the space left is
 * shared between them, so that an IBAN stays on one line; otherwise they get the same width and their lines wrap.
 */
function footerColumns(columns: readonly string[][], m: Metrics): { x: number; lines: string[] }[] {
  const total = RIGHT - LEFT;
  const natural = columns.map((lines) => Math.max(0, ...lines.map((l) => m.width(l, 'regular', SIZE.footer))));
  const free = total - natural.reduce((sum, w) => sum + w, 0);
  const gaps = Math.max(columns.length - 1, 1);
  if (free >= gaps * 3 * MM) {
    let x = LEFT;
    return columns.map((lines, i) => {
      const placed = { x, lines };
      x += (natural[i] ?? 0) + free / gaps;
      return placed;
    });
  }
  const width = total / Math.max(columns.length, 1);
  return columns.map((lines, i) => ({ x: LEFT + i * width, lines: lines.flatMap((l) => wrap(l, width - 3 * MM, 'regular', SIZE.footer, m)) }));
}

/** The footer of every page: the company's footer text, its columns, and the page number. Returns its top. */
function footer(c: DocumentContent, m: Metrics): { items: (page: number, pages: number) => Item[]; top: number } {
  const lh = lineHeight(SIZE.footer);
  const placed = footerColumns(c.footer.columns, m);
  const columns = placed.map((p) => p.lines);
  const text = wrap(c.footer.text, RIGHT - LEFT, 'regular', SIZE.footer, m);
  const pageLine = PAGE.height - 10 * MM;
  const columnsTop = pageLine - 5 * MM - Math.max(0, ...columns.map((col) => col.length)) * lh;
  const textTop = columnsTop - (text.length ? text.length * lh + 2 * MM : 0);
  const top = textTop - 3 * MM;
  const items = (page: number, pages: number): Item[] => [
    { kind: 'rule', x1: LEFT, y1: top, x2: RIGHT, y2: top, width: 0.4, tone: 'rule' },
    ...text.map((line, i): Item => ({ kind: 'text', x: LEFT, y: textTop + SIZE.footer * ASCENT + i * lh, text: line, size: SIZE.footer, font: 'regular', tone: 'muted' })),
    ...columns.flatMap((col, ci) =>
      col.map((line, i): Item => ({ kind: 'text', x: placed[ci]?.x ?? LEFT, y: columnsTop + SIZE.footer * ASCENT + i * lh, text: line, size: SIZE.footer, font: 'regular', tone: 'muted' })),
    ),
    (() => {
      const label = c.pageLabel.replace('{n}', String(page)).replace('{m}', String(pages));
      return { kind: 'text', x: RIGHT - m.width(label, 'regular', SIZE.footer), y: pageLine, text: label, size: SIZE.footer, font: 'regular', tone: 'muted' } as const;
    })(),
  ];
  return { items, top };
}

/** The lines of one table row: the name and its description in the name column, the other cells on the first line */
function rowLines(row: TableRow, nameWidth: number, m: Metrics): { name: string[]; description: string[]; height: number } {
  const name = wrap(row.name, nameWidth - COLUMN_GAP, 'regular', SIZE.table, m);
  const description = wrap(row.description, nameWidth - COLUMN_GAP, 'regular', SIZE.description, m);
  const height = Math.max(name.length, 1) * lineHeight(SIZE.table) + description.length * lineHeight(SIZE.description) + 2 * MM;
  return { name, description, height };
}

/** Lays out a quote or an invoice on A4 pages */
export function layoutDocument(c: DocumentContent, m: Metrics, options: { logo: boolean }): Layout {
  const foot = footer(c, m);
  const bodyBottom = foot.top - 5 * MM;
  const cols = columns(c.table.showRate);
  const nameCol = cols.find((p) => p.col.key === 'name');
  const nameWidth = nameCol?.col.width ?? 0;
  const headerHeight = lineHeight(SIZE.table) + 2 * MM;
  let inTable = false;

  const flow: Flow = new Flow(c, m, bodyBottom, () => {
    if (inTable) tableHeader();
  });

  function tableHeader() {
    for (const { col, x } of cols) {
      const label = c.table.headers[col.key];
      flow.text(cellX(label, col, x, 'bold', SIZE.table, m), label, SIZE.table, 'bold', 'muted');
    }
    flow.y += lineHeight(SIZE.table) + 0.5 * MM;
    flow.add({ kind: 'rule', x1: LEFT, y1: flow.y, x2: RIGHT, y2: flow.y, width: 0.6, tone: 'rule' });
    flow.y += 1.5 * MM;
  }

  const first = firstPage(c, m, options.logo);
  flow.start(first.bottom);
  flow.page.items.push(...first.items);

  // title, subject and introduction
  flow.paragraph(c.title, SIZE.title, 'bold', 'text', 2 * MM);
  flow.paragraph(c.subject, SIZE.subject, 'bold', 'text', 3 * MM);
  flow.paragraph(c.intro, SIZE.body, 'regular', 'text', 4 * MM);

  // the lines
  if (c.table.rows.length > 0) {
    const firstRow = c.table.rows[0];
    flow.ensure(headerHeight + (firstRow ? rowLines(firstRow, nameWidth, m).height : 0));
    tableHeader();
    inTable = true;
    for (const row of c.table.rows) {
      const lines = rowLines(row, nameWidth, m);
      // a row stays on one page unless it is longer than a whole page
      if (lines.height > flow.room && lines.height <= bodyBottom - 22 * MM - headerHeight) flow.newPage();
      const top = flow.y;
      for (const { col, x } of cols) {
        if (col.key === 'name') continue;
        const value = row[col.key];
        flow.text(cellX(value, col, x, 'regular', SIZE.table, m), value, SIZE.table);
      }
      for (const line of lines.name) {
        flow.ensure(lineHeight(SIZE.table));
        flow.text(nameCol?.x ?? LEFT, line, SIZE.table);
        flow.y += lineHeight(SIZE.table);
      }
      if (lines.name.length === 0) flow.y += lineHeight(SIZE.table);
      for (const line of lines.description) {
        flow.ensure(lineHeight(SIZE.description));
        flow.text(nameCol?.x ?? LEFT, line, SIZE.description, 'regular', 'muted');
        flow.y += lineHeight(SIZE.description);
      }
      flow.y = Math.max(flow.y, top) + 1.2 * MM;
      flow.add({ kind: 'rule', x1: LEFT, y1: flow.y, x2: RIGHT, y2: flow.y, width: 0.3, tone: 'rule' });
      flow.y += 0.8 * MM;
    }
    inTable = false;
    flow.y += 2 * MM;
  }

  // the totals stay together, right aligned
  const labelX = RIGHT - 95 * MM;
  const labelWidth = 65 * MM;
  const totals = c.totals.map((t) => {
    const size = t.grand ? SIZE.grand : SIZE.total;
    return { ...t, size, labels: wrap(t.label, labelWidth, t.grand ? 'bold' : 'regular', size, m) };
  });
  const totalsHeight = totals.reduce((sum, t) => sum + t.labels.length * lineHeight(t.size) + (t.grand ? 2 * MM : 0.5 * MM), 0);
  flow.ensure(totalsHeight);
  for (const t of totals) {
    const font: FontKind = t.grand ? 'bold' : 'regular';
    if (t.grand) {
      flow.add({ kind: 'rule', x1: labelX, y1: flow.y, x2: RIGHT, y2: flow.y, width: 0.6, tone: 'rule' });
      flow.y += 1.5 * MM;
    }
    t.labels.forEach((l, i) => flow.add({ kind: 'text', x: labelX, y: flow.y + t.size * ASCENT + i * lineHeight(t.size), text: l, size: t.size, font, tone: 'text' }));
    flow.add({ kind: 'text', x: RIGHT - m.width(t.value, font, t.size), y: flow.y + t.size * ASCENT, text: t.value, size: t.size, font, tone: 'text' });
    flow.y += t.labels.length * lineHeight(t.size) + 0.5 * MM;
  }
  flow.y += 5 * MM;

  // notes and closing text
  for (const note of c.notes) flow.paragraph(note, SIZE.body);
  flow.paragraph(c.closing, SIZE.body);

  const pages = flow.pages.length;
  flow.pages.forEach((page, i) => page.items.push(...foot.items(i + 1, pages)));
  return { width: PAGE.width, height: PAGE.height, pages: flow.pages };
}
