/**
 * Paints highlights over the parts of a reply that quotes name. The quotes
 * come from a separate model that read the reply after it was written, so the
 * reply itself holds no marks.
 *
 * A quote is found by its letters and digits alone, so one that differs from
 * the reply in spacing, case, markdown symbols, punctuation or list numbers
 * still lands, and one may run over several lines (a question and its
 * options). A line a highlight touches is read into styled spans the mod draws
 * itself; every other line stays markdown the surface draws as it always does.
 *
 * A color code in the text (`#0066CC`, `rgb(0, 102, 204)`) is found by the
 * mod itself, with no model, and its line is painted too: the code is drawn
 * on its own color, the way an editor's color highlighter shows it.
 */

/**
 * What a highlight means: needs the person's decision (yellow), the key
 * result (blue), a warning (red), or work done and verified (green).
 */
export type Mark = 'decide' | 'key' | 'warn' | 'done'

/** One part of a reply to highlight, quoted from it, and how. */
export type Quote = { mark: Mark; text: string }

/** A run of text drawn in one style. */
export type Span = {
  text: string
  mark?: Mark
  /** The color this span names, as `#RRGGBB`, drawn as its background. */
  swatch?: string
  bold?: true
  italic?: true
  strike?: true
  code?: true
  href?: string
}

/** One line, read for the shape markdown would give it. */
export type Line =
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'item'; indent: number; bullet: string; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'para'; indent: number; spans: Span[] }

/** What a reply is drawn as, top to bottom. */
export type Block =
  | { kind: 'markdown'; text: string }
  | { kind: 'line'; line: Line }
  | { kind: 'gap' }

type Style = Omit<Span, 'text'>

/**
 * One line of the reply. A `text` row can be painted: `plain` is the text it
 * shows and `marks` the highlight on each of its characters. A `raw` row (a
 * code fence, a table, a rule) stays markdown: quotes are matched over its
 * `plain` but never paint it. A `blank` row separates blocks.
 */
type Row =
  | { kind: 'text'; raw: string; line: Line; plain: string; marks: (Mark | undefined)[]; hasColor: boolean }
  | { kind: 'raw'; raw: string; plain: string }
  | { kind: 'blank'; raw: string }

/** The reply's letters and digits, lowercased, each with where it came from. */
type Stream = { letters: string; from: (Place | undefined)[] }

/** A character of a text row; a raw row's have no place, as nothing paints them. */
type Place = { row: number; at: number }

// Painted weakest first, so where two highlights meet the stronger one shows.
const ORDER: readonly Mark[] = ['done', 'key', 'warn', 'decide']

// A color code: six or eight hex digits after a hash (three are left alone,
// as an issue number looks the same), or rgb() and rgba() with whole numbers.
const COLOR = /(?<![\w&#])#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?(?![\w-])|\brgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g

const LETTER = /[\p{L}\p{N}]/u
// A list's numbers are drawn beside its lines, not in them: one a quote copied
// at the start of a line, or inside a quote that ran the list's lines together.
const LINE_NUMBER = /^[ \t]*\d{1,9}[.)][ \t]+/gm
const JOINED_NUMBER = /(?<=[\s:?.!])\d{1,2}[.)](?=\s)/g
const ELLIPSIS = /\.{3,}|…/

// Inline code is swapped for a slot first, so nothing inside it reads as markdown.
const CODE = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
const SLOT = /(\d+)/g

// Every inline form a line may hold; the earliest match wins.
const INLINE = new RegExp(
  [
    String.raw`\*\*(?=\S)(.+?)(?<=\S)\*\*`, // 1 bold
    String.raw`(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])`, // 2 bold
    String.raw`~~(?=\S)(.+?)(?<=\S)~~`, // 3 strikethrough
    String.raw`(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])`, // 4 italic
    String.raw`(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])`, // 5 italic
    String.raw`\[([^\]\n]+)\]\(([^()\s]+)(?:\s+"[^"]*")?\)`, // 6 label, 7 href
  ].join('|'),
  'g',
)

// Fences inside list items are indented, so any indent opens one.
const FENCE = /^\s*(`{3,}|~{3,})/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/
const TABLE = /^\s*\|/
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|~=?<>])/g

/**
 * Splits a reply into markdown and painted lines, each quote painted where it
 * is found; null when no quote lands on a line that can be painted.
 */
export function plan(text: string, quotes: readonly Quote[]): Block[] | null {
  const rows = read(text)
  const stream = streamOf(rows)
  let isPainted = false
  for (const mark of ORDER) {
    for (const quote of quotes) {
      if (quote.mark !== mark) continue
      const found = locate(stream.letters, quote.text)
      if (found !== undefined && paint(rows, stream, found, mark)) isPainted = true
    }
  }
  if (!isPainted && !rows.some(row => row.kind === 'text' && row.hasColor)) return null

  const blocks: Block[] = []
  let markdown: string[] = []

  const gap = () => {
    const last = blocks[blocks.length - 1]
    if (last !== undefined && last.kind !== 'gap') blocks.push({ kind: 'gap' })
  }
  const flush = () => {
    let end = markdown.length
    while (end > 0 && markdown[end - 1]!.trim() === '') end -= 1
    if (end > 0) blocks.push({ kind: 'markdown', text: markdown.slice(0, end).join('\n') })
    if (end < markdown.length) gap()
    markdown = []
  }

  for (const row of rows) {
    if (row.kind === 'text' && (row.marks.length > 0 || row.hasColor)) {
      flush()
      blocks.push({ kind: 'line', line: swatched(painted(row.line, row.marks)) })
    } else if (row.kind === 'blank' && markdown.length === 0) {
      gap()
    } else {
      markdown.push(row.raw)
    }
  }
  flush()
  while (blocks[blocks.length - 1]?.kind === 'gap') blocks.pop()

  return blocks
}

/** Reads one line of markdown into its shape and styled spans. */
export function readLine(raw: string): Line {
  const { hidden, codes } = hide(raw)
  const spans = (body: string) => inline(body, {}, codes)

  const heading = HEADING.exec(hidden)
  if (heading) return { kind: 'heading', spans: spans(heading[1] ?? '') }

  const item = ITEM.exec(hidden)
  if (item) {
    const [, lead = '', marker = '', task, body = ''] = item
    const bullet = task !== undefined ? (task === ' ' ? '☐' : '☑') : /\d/.test(marker) ? marker : '•'
    return { kind: 'item', indent: lead.length, bullet, spans: spans(body) }
  }

  const quote = QUOTE.exec(hidden)
  if (quote) return { kind: 'quote', spans: spans(quote[1] ?? '') }

  const lead = /^\s*/.exec(hidden)?.[0] ?? ''
  return { kind: 'para', indent: lead.length, spans: spans(hidden.slice(lead.length)) }
}

function read(text: string): Row[] {
  const rows: Row[] = []
  let fence: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (fence !== undefined) {
      const close = FENCE_CLOSE.exec(raw)?.[1]
      const isClose = close !== undefined && close[0] === fence[0] && close.length >= fence.length
      if (isClose) fence = undefined
      rows.push({ kind: 'raw', raw, plain: isClose ? '' : raw })
      continue
    }
    const open = FENCE.exec(raw)?.[1]
    if (open !== undefined) {
      fence = open
      // The opening line names a language, which no quote holds.
      rows.push({ kind: 'raw', raw, plain: '' })
    } else if (raw.trim() === '') {
      rows.push({ kind: 'blank', raw })
    } else if (TABLE.test(raw)) {
      rows.push({ kind: 'raw', raw, plain: raw })
    } else if (RULE.test(raw)) {
      rows.push({ kind: 'raw', raw, plain: '' })
    } else {
      const line = readLine(raw)
      const plain = line.spans.map(span => span.text).join('')
      rows.push({ kind: 'text', raw, line, plain, marks: [], hasColor: hasColor(plain) })
    }
  }

  return rows
}

function streamOf(rows: readonly Row[]): Stream {
  let letters = ''
  const from: (Place | undefined)[] = []
  rows.forEach((row, at) => {
    if (row.kind === 'blank') return
    let i = 0
    for (const ch of row.plain) {
      if (LETTER.test(ch)) {
        const low = ch.toLowerCase()
        letters += low
        for (let k = 0; k < low.length; k += 1) from.push(row.kind === 'text' ? { row: at, at: i } : undefined)
      }
      i += ch.length
    }
  })

  return { letters, from }
}

/** Where a quote stands in the reply's letters, as [start, end). */
function locate(letters: string, quote: string): [number, number] | undefined {
  const text = quote.replace(LINE_NUMBER, '')

  return within(letters, text) ?? within(letters, text.replace(JOINED_NUMBER, ''))
}

/** Finds each part of a quote an ellipsis cut, in order. */
function within(letters: string, quote: string): [number, number] | undefined {
  const parts = quote
    .split(ELLIPSIS)
    .map(lettersOf)
    .filter(part => part.length >= 3)
  let start: number | undefined
  let end = 0
  for (const part of parts) {
    const found = find(letters, part, end)
    if (found === undefined) return undefined
    start ??= found[0]
    end = found[1]
  }

  return start === undefined ? undefined : [start, end]
}

/**
 * Where `part` stands from `from` on: exactly, else by its first and last
 * twelve letters, so a quote with a word changed in its middle still lands.
 */
function find(letters: string, part: string, from: number): [number, number] | undefined {
  const at = letters.indexOf(part, from)
  if (at >= 0) return [at, at + part.length]
  if (part.length < 24) return undefined

  const head = part.slice(0, 12)
  const tail = part.slice(-12)
  for (let h = letters.indexOf(head, from); h >= 0; h = letters.indexOf(head, h + 1)) {
    for (let t = letters.indexOf(tail, h + head.length); t >= 0; t = letters.indexOf(tail, t + 1)) {
      const size = t + tail.length - h
      if (size > part.length * 1.5) break
      if (size >= part.length / 2) return [h, t + tail.length]
    }
  }

  return undefined
}

/** Paints the text rows a found quote covers; false when it covers none. */
function paint(rows: Row[], stream: Stream, [start, end]: [number, number], mark: Mark): boolean {
  const covered = new Map<number, [number, number]>()
  for (let i = start; i < end; i += 1) {
    const place = stream.from[i]
    if (place === undefined) continue
    covered.set(place.row, [covered.get(place.row)?.[0] ?? place.at, place.at])
  }
  for (const [at, [first, last]] of covered) {
    const row = rows[at]
    if (row?.kind !== 'text') continue
    const [from, to] = widen(row.plain, first, last)
    for (let i = from; i < to; i += 1) row.marks[i] = mark
  }

  return covered.size > 0
}

/** Grows a painted run out to whole words and the punctuation that ends them. */
function widen(plain: string, first: number, last: number): [number, number] {
  let from = first
  let to = last + 1
  while (from > 0 && !/\s/.test(plain[from - 1]!)) from -= 1
  while (to < plain.length && !/\s/.test(plain[to]!)) to += 1

  return [from, to]
}

/** The line with its spans cut where the highlight changes. */
function painted(line: Line, marks: readonly (Mark | undefined)[]): Line {
  const spans: Span[] = []
  let at = 0
  for (const span of line.spans) {
    let start = 0
    for (let i = 1; i <= span.text.length; i += 1) {
      if (i < span.text.length && marks[at + i] === marks[at + start]) continue
      const mark = marks[at + start]
      const text = span.text.slice(start, i)
      spans.push(mark === undefined ? { ...span, text } : { ...span, text, mark })
      start = i
    }
    at += span.text.length
  }

  return { ...line, spans }
}

const hasColor = (text: string) => {
  COLOR.lastIndex = 0

  return COLOR.test(text)
}

/** The color a code names, as `#RRGGBB`; nothing for an rgb() out of range. */
export function colorOf(code: string): string | undefined {
  COLOR.lastIndex = 0
  const m = COLOR.exec(code)
  if (m === null) return undefined
  if (m[1] !== undefined) return `#${m[1].toUpperCase()}`
  const parts = [m[2], m[3], m[4]].map(Number)
  if (parts.some(part => part > 255)) return undefined

  return `#${parts.map(part => part.toString(16).padStart(2, '0').toUpperCase()).join('')}`
}

/** The line with each color code in its own span, naming its color. */
function swatched(line: Line): Line {
  const spans: Span[] = []
  for (const span of line.spans) {
    let at = 0
    for (const m of span.text.matchAll(COLOR)) {
      const swatch = colorOf(m[0])
      if (swatch === undefined) continue
      if (m.index > at) spans.push({ ...span, text: span.text.slice(at, m.index) })
      spans.push({ ...span, text: m[0], swatch })
      at = m.index + m[0].length
    }
    if (at < span.text.length) spans.push(at === 0 ? span : { ...span, text: span.text.slice(at) })
  }

  return { ...line, spans }
}

function hide(raw: string): { hidden: string; codes: string[] } {
  const codes: string[] = []
  const hidden = raw.replace(CODE, (_whole, _ticks, body: string) => {
    codes.push(/^ .*[^ ].* $/.test(body) ? body.slice(1, -1) : body)
    return slot(codes.length - 1)
  })

  return { hidden, codes }
}

function inline(text: string, style: Style, codes: readonly string[]): Span[] {
  const spans: Span[] = []
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    spans.push(...literal(text.slice(at, m.index), style, codes))
    if (m[1] !== undefined || m[2] !== undefined) {
      spans.push(...inline(m[1] ?? m[2] ?? '', { ...style, bold: true }, codes))
    } else if (m[3] !== undefined) {
      spans.push(...inline(m[3], { ...style, strike: true }, codes))
    } else if (m[4] !== undefined || m[5] !== undefined) {
      spans.push(...inline(m[4] ?? m[5] ?? '', { ...style, italic: true }, codes))
    } else {
      spans.push(...inline(m[6] ?? '', { ...style, href: m[7] ?? '' }, codes))
    }
    at = m.index + m[0].length
  }
  spans.push(...literal(text.slice(at), style, codes))

  return spans
}

/** Text with its code slots put back as code spans. */
function literal(text: string, style: Style, codes: readonly string[]): Span[] {
  const spans: Span[] = []
  let at = 0
  for (const m of text.matchAll(SLOT)) {
    if (m.index > at) spans.push({ ...style, text: unescape(text.slice(at, m.index)) })
    spans.push({ ...style, code: true, text: codes[Number(m[1])] ?? '' })
    at = m.index + m[0].length
  }
  if (at < text.length) spans.push({ ...style, text: unescape(text.slice(at)) })

  return spans
}

function lettersOf(text: string): string {
  let letters = ''
  for (const ch of text) if (LETTER.test(ch)) letters += ch.toLowerCase()

  return letters
}

const slot = (at: number) => `${at}`
const unescape = (text: string) => text.replace(ESCAPE, '$1')
