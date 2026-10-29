/**
 * What `/highlight-preview` draws: what each color means, and a short sample
 * reply with one highlight of each color, as Haiku would pick them.
 */

import type { Mark, Quote } from './marks'

/** The command's name; the person types `/highlight-preview`. */
export const PREVIEW = 'highlight-preview'

/** What each color means, in the order the legend shows them. */
export const LEGEND: readonly (readonly [Mark, string])[] = [
  ['decide', 'needs your decision'],
  ['key', 'key result'],
  ['warn', 'warning'],
  ['done', 'done and verified'],
]

export const SAMPLE = [
  'I found why the export fails.',
  '',
  'The parser stops at the first tab, so every row after it is dropped.',
  '',
  "Running the old export again overwrites last week's file.",
  '',
  'The fix passes all 42 tests.',
  '',
  'The chart keeps its blue, `#0066CC`, and the error rows turn rgb(200, 80, 27).',
  '',
  'Which fix do you want?',
  '',
  '1. Patch the regex: fast, small risk.',
  '2. Rewrite the parser: slow, safe.',
].join('\n')

export const SAMPLE_QUOTES: readonly Quote[] = [
  { mark: 'key', text: 'The parser stops at the first tab, so every row after it is dropped.' },
  { mark: 'warn', text: "Running the old export again overwrites last week's file." },
  { mark: 'done', text: 'The fix passes all 42 tests.' },
  {
    mark: 'decide',
    text: 'Which fix do you want?\n\n1. Patch the regex: fast, small risk.\n2. Rewrite the parser: slow, safe.',
  },
]
