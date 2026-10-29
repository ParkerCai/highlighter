import { describe, expect, mock, test } from 'claude-code/testing'
import type { ModelCompleteResult } from 'claude-code'

import { colorOf, plan, readLine } from '../hooks/marks'
import { TINT, inkOn } from '../hooks/register'
import { ALIAS, MODEL, idOf, readQuotes } from '../hooks/select'
import type { Quote } from '../hooks/marks'

const REPLY = [
  'Found it.',
  '',
  'The bug is in `parse()`: the regex misses **tabs**.',
  '',
  '- Deleting the cache drops unsaved drafts.',
  '- All 42 tests pass.',
  '',
  'Which fix do you want?',
  '',
  '1. Patch the regex: fast, small risk.',
  '2. Rewrite the parser: slow, safe.',
  '',
  '```js',
  'const total = 42',
  '```',
].join('\n')

const ASKED = 'Why does parse() choke on tabs?'

// What Haiku picks for REPLY, copied the way a model may copy: symbols kept,
// spacing changed.
const QUOTES: Quote[] = [
  { mark: 'key', text: 'The bug is in `parse()`: the regex misses **tabs**.' },
  { mark: 'warn', text: 'Deleting the cache drops unsaved drafts.' },
  { mark: 'done', text: 'All 42 tests pass.' },
  { mark: 'decide', text: 'Which fix do you want?\n1. Patch the regex: fast, small risk.\n2. Rewrite the parser: slow, safe.' },
]

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const HIGHLIGHT = { backgroundColor: '#FFE066', color: '#111111', bold: true }
const USAGE = { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ANSWER = JSON.stringify(QUOTES.map(quote => ({ mark: quote.mark, quote: quote.text })))
const engine = () => ({ type: 'Text' as const, children: ['engine'] })
/** Answers `$.config.list()` with Claude Code's theme row set to `name`. */
const themed = (name: string) => () => ({
  value: [{ key: 'theme', label: 'Theme', kind: 'choice' as const, value: name, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false }],
})
const ANSWERED: ModelCompleteResult = { isAnswered: true, text: ANSWER, usage: USAGE }
const FAILED: ModelCompleteResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }

const kinds = (text: string, quotes: readonly Quote[]) => plan(text, quotes)?.map(block => block.kind)
/** Each painted line, as its spans' text and highlight. */
const painted = (text: string, quotes: readonly Quote[]) =>
  plan(text, quotes)?.flatMap(block =>
    block.kind === 'line' ? [block.line.spans.map(span => [span.text, span.mark ?? '-'])] : [],
  )

describe('plan', () => {
  test('leaves a reply no quote lands on to the engine', () => {
    expect(plan(REPLY, [])).toBeNull()
    expect(plan(REPLY, [{ mark: 'key', text: 'Something the reply never says.' }])).toBeNull()
  })

  test('splits a reply into markdown and painted lines', () => {
    expect(kinds(REPLY, QUOTES)).toEqual([
      'markdown',
      'gap',
      'line',
      'gap',
      'line',
      'line',
      'gap',
      'line',
      'gap',
      'line',
      'line',
      'gap',
      'markdown',
    ])
  })

  test('paints what a quote covers, out to whole words, and keeps the styles', () => {
    expect(plan('The bug is in `parse()`: the regex misses **tabs**.', [{ mark: 'key', text: 'bug is in parse' }])).toEqual([
      {
        kind: 'line',
        line: {
          kind: 'para',
          indent: 0,
          spans: [
            { text: 'The ' },
            { mark: 'key', text: 'bug is in ' },
            { mark: 'key', code: true, text: 'parse()' },
            { mark: 'key', text: ':' },
            { text: ' the regex misses ' },
            { bold: true, text: 'tabs' },
            { text: '.' },
          ],
        },
      },
    ])
  })

  test('finds a quote whatever its spacing, case and list numbers', () => {
    const quote = 'which fix do you want? 1. Patch the regex: fast, small risk. 2. Rewrite the parser: slow, safe'

    expect(painted(REPLY, [{ mark: 'decide', text: quote }])).toEqual([
      [['Which fix do you want?', 'decide']],
      [['Patch the regex: fast, small risk.', 'decide']],
      [['Rewrite the parser: slow, safe.', 'decide']],
    ])
  })

  test('lands a quote with a word changed, or cut short by an ellipsis', () => {
    expect(painted(REPLY, [{ mark: 'warn', text: 'Deleting the cache loses unsaved drafts.' }])).toEqual([
      [['Deleting the cache drops unsaved drafts.', 'warn']],
    ])
    expect(painted(REPLY, [{ mark: 'decide', text: 'Which fix do you want? ... slow, safe.' }])).toHaveLength(3)
  })

  test('shows the stronger highlight where two meet', () => {
    const quotes: Quote[] = [
      { mark: 'decide', text: 'Patch the regex' },
      { mark: 'key', text: 'Patch the regex: fast, small risk.' },
    ]

    expect(painted(REPLY, quotes)).toEqual([
      [
        ['Patch the regex:', 'decide'],
        [' fast, small risk.', 'key'],
      ],
    ])
  })

  test('never paints code or tables', () => {
    expect(plan(REPLY, [{ mark: 'warn', text: 'const total = 42' }])).toBeNull()
    expect(plan('| a | b |\n|---|---|\n| keep the old parser | yes |', [{ mark: 'key', text: 'keep the old parser' }])).toBeNull()
  })

  test('paints the lines around a code block a quote runs over', () => {
    const reply = 'Run this?\n```\nrm -rf build\n```\nOk to go ahead?'

    expect(kinds(reply, [{ mark: 'decide', text: reply }])).toEqual(['line', 'markdown', 'line'])
  })
})

describe('color codes', () => {
  const COLORED = [
    'Use `#0066CC` for links and rgb(200, 80, 27) for warnings; issue #123 tracks it.',
    '',
    'Plain line.',
    '',
    '```css',
    'a { color: #12A05E }',
    '```',
  ].join('\n')

  test('reads a code as its color', () => {
    expect(colorOf('#0066cc')).toBe('#0066CC')
    expect(colorOf('#0066CC80')).toBe('#0066CC')
    expect(colorOf('rgb(200, 80, 27)')).toBe('#C8501B')
    expect(colorOf('rgba(0,102,204,0.5)')).toBe('#0066CC')
    expect(colorOf('rgb(300, 0, 0)')).toBeUndefined()
    expect(colorOf('#123')).toBeUndefined()
  })

  test('paints each code on its color, with no quote at all, and leaves code blocks alone', () => {
    const blocks = plan(COLORED, [])
    expect(blocks?.map(block => block.kind)).toEqual(['line', 'gap', 'markdown'])
    const first = blocks?.[0]
    if (first?.kind !== 'line') throw new Error('not a line')
    expect(first.line.spans.map(span => [span.text, span.swatch ?? '-', span.code ? 'code' : '-'])).toEqual([
      ['Use ', '-', '-'],
      ['#0066CC', '#0066CC', 'code'],
      [' for links and ', '-', '-'],
      ['rgb(200, 80, 27)', '#C8501B', '-'],
      [' for warnings; issue #123 tracks it.', '-', '-'],
    ])
  })

  test('paints every code on a line, a bare hex before an rgb() included', () => {
    const blocks = plan('Codes like #0066CC and rgb(200, 80, 27) in color, then #12A05E too.', [])
    const first = blocks?.[0]
    if (first?.kind !== 'line') throw new Error('not a line')
    expect(first.line.spans.filter(span => span.swatch).map(span => [span.text, span.swatch])).toEqual([
      ['#0066CC', '#0066CC'],
      ['rgb(200, 80, 27)', '#C8501B'],
      ['#12A05E', '#12A05E'],
    ])
  })

  test('keeps a code inside a highlight on its own color', () => {
    const blocks = plan(COLORED, [{ mark: 'key', text: 'Use #0066CC for links' }])
    const first = blocks?.[0]
    if (first?.kind !== 'line') throw new Error('not a line')
    expect(first.line.spans.slice(0, 3).map(span => [span.text, span.mark ?? '-', span.swatch ?? '-'])).toEqual([
      ['Use ', 'key', '-'],
      ['#0066CC', 'key', '#0066CC'],
      [' for links', 'key', '-'],
    ])
  })

  test('picks dark text on a light color and light text on a dark one', () => {
    expect(inkOn('#FFE066')).toBe('#111111')
    expect(inkOn('#12A05E')).toBe('#111111')
    expect(inkOn('#0066CC')).toBe('#FFFFFF')
    expect(inkOn('#1C1C1C')).toBe('#FFFFFF')
  })

  test('leaves codes alone once the setting is off', async ($, on) => {
    mock.store(on)
    on('config.set', ($, e) => ({ value: e.value }))
    on('ui.render', { component: 'AssistantMessage' }, engine)

    expect(plan(COLORED, [], false)).toBeNull()
    await $.config.set({ key: 'highlighter.colorCodes', value: false, previous: true, provider: { plugin: 'highlighter', tier: 'user' }, origin: { kind: 'composer' } })
    const ui = await $.ui.mount({
      plugin: 'highlighter',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: { text: COLORED, isFirstOfReply: true },
    })
    expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
    await ui.unmount()
  })

  test('draws a code on its color before Haiku answers, on every surface', async ($, on) => {
    mock.store(on)
    on('ui.render', { component: 'AssistantMessage' }, engine)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'highlighter',
        surface,
        component: 'AssistantMessage',
        props: { text: COLORED, isFirstOfReply: true },
      })
      const found = (await ui.findAll({ type: 'Text', text: /^#0066CC$/ })).map(text => text.props).find(props => 'backgroundColor' in props)
      expect(found).toMatchObject({ backgroundColor: '#0066CC', color: '#FFFFFF' })
      const rgb = (await ui.findAll({ type: 'Text', text: /^rgb\(200, 80, 27\)$/ })).map(text => text.props).find(props => 'backgroundColor' in props)
      expect(rgb).toMatchObject({ backgroundColor: '#C8501B', color: '#111111' })
      expect((await ui.find({ type: 'Markdown', text: /color: #12A05E/ }))?.type).toBe('Markdown')
      await ui.unmount()
    }
  })
})

describe('readLine', () => {
  test('reads code, bold and links in a list item', () => {
    expect(readLine('  - **Do not run it twice.** It [drops](https://x.dev) rows.')).toEqual({
      kind: 'item',
      indent: 2,
      bullet: '•',
      spans: [
        { bold: true, text: 'Do not run it twice.' },
        { text: ' It ' },
        { href: 'https://x.dev', text: 'drops' },
        { text: ' rows.' },
      ],
    })
  })

  test('reads headings, numbered items, tasks and quotes', () => {
    expect(readLine('## Result').kind).toBe('heading')
    expect(readLine('3. Done.')).toMatchObject({ kind: 'item', bullet: '3.' })
    expect(readLine('- [x] Shipped')).toMatchObject({ kind: 'item', bullet: '☑' })
    expect(readLine('> Your call.').kind).toBe('quote')
  })
})

describe("Haiku's answer", () => {
  test('reads the quotes out of a fenced JSON answer and drops the rest', () => {
    const answer = '```json\n[{"mark":"decide","quote":"Ship it?"},{"mark":"loud","quote":"x"},{"mark":"key"}]\n```'

    expect(readQuotes(answer)).toEqual([{ mark: 'decide', text: 'Ship it?' }])
    expect(readQuotes('Nothing to mark.')).toEqual([])
    // A quote the length of a reply is not a highlight.
    expect(readQuotes(JSON.stringify([{ mark: 'key', quote: 'x'.repeat(601) }]))).toEqual([])
  })

  test('names a reply the same whatever its spacing', () => {
    expect(idOf('Done.\n\nAll good. ')).toBe(idOf('Done. All good.'))
    expect(idOf('Done. All good.')).not.toBe(idOf('Done. All bad.'))
  })
})

describe('after a turn', () => {
  test('asks Haiku about the reply and paints its picks on every surface', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('config.list', themed('light'))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    const asked: { model: string; prompt: string; system?: string; effort?: string }[] = []
    on('model.complete', ($, e) => {
      asked.push({ model: e.model, prompt: e.prompt, system: e.system, effort: e.effort })
      return { value: ANSWERED }
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AssistantMessage' }, engine)

    await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: ASKED, turnId: 't1' })
    await $.turn.complete({ answer: REPLY, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()

    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ model: MODEL })
    // Haiku thinks at its own default effort.
    expect(asked[0]?.effort).toBeUndefined()
    expect(asked[0]?.system).toContain('decide: what the reply waits on the person for')
    expect(asked[0]?.prompt).toContain(ASKED)
    expect(asked[0]?.prompt).toContain(REPLY)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'highlighter',
        surface,
        component: 'AssistantMessage',
        props: { text: REPLY, isFirstOfReply: true },
      })
      // The span holding the text, not a line around it that shows the same words.
      const styleOf = async (text: RegExp) =>
        (await ui.findAll({ type: 'Text', text })).map(found => found.props).find(props => 'color' in props)

      expect(await styleOf(/^Which fix do you want\?$/)).toMatchObject(HIGHLIGHT)
      expect(await styleOf(/^Patch the regex: fast, small risk\.$/)).toMatchObject(HIGHLIGHT)
      expect(await styleOf(/^Rewrite the parser: slow, safe\.$/)).toMatchObject(HIGHLIGHT)
      for (const [text, color] of [
        [/^The bug is in $/, '#0066CC'],
        [/^Deleting the cache drops unsaved drafts\.$/, '#C8501B'],
        [/^All 42 tests pass\.$/, '#12A05E'],
      ] as const) {
        const style = await styleOf(text)
        expect(style?.color).toBe(color)
        expect(style?.backgroundColor).toBeUndefined()
      }
      expect((await ui.find({ type: 'Markdown', text: 'Found it.' }))?.text).toBe('Found it.')
      expect((await ui.find({ type: 'Markdown', text: /const total = 42/ }))?.type).toBe('Markdown')
      await ui.unmount()
    }
  })

  test('draws a reply as the engine does until its highlights arrive', async ($, on) => {
    mock.store(on)
    on('ui.render', { component: 'AssistantMessage' }, engine)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'highlighter',
        surface,
        component: 'AssistantMessage',
        props: { text: REPLY, isFirstOfReply: true },
      })
      expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
      await ui.unmount()
    }
  })

  test('repaints a reply already on screen once Haiku answers', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('model.complete', () => ({ value: ANSWERED }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AssistantMessage' }, engine)

    const ui = await $.ui.mount({
      plugin: 'highlighter',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
    })
    expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')

    await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    await clock.settle()
    const found = await ui.findAll({ type: 'Text', text: /^Which fix do you want\?$/ })

    expect(found.map(text => text.props).find(props => 'color' in props)).toMatchObject(HIGHLIGHT)
    await ui.unmount()
  })

  test('keeps the highlights for the next session, and those an earlier version saved', async ($, on) => {
    const older = `${REPLY}\nSaved by version 0.11.`
    mock.store(on, { picks: { [idOf(REPLY)]: QUOTES }, [`marks:${idOf(older)}`]: QUOTES })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.render', { component: 'AssistantMessage' }, engine)

    await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })
    for (const text of [REPLY, older]) {
      const ui = await $.ui.mount({
        plugin: 'highlighter',
        surface: 'desktop',
        component: 'AssistantMessage',
        props: { text, isFirstOfReply: true },
      })
      const found = await ui.findAll({ type: 'Text', text: /^Which fix do you want\?$/ })

      expect(found.map(text => text.props).find(props => 'color' in props)).toMatchObject(HIGHLIGHT)
      await ui.unmount()
    }
  })

  test('keeps the last 500 replies and drops the oldest', async ($, on) => {
    const clock = mock.clock(on)
    const old = (at: number) => `${REPLY}\nOld reply ${at}.`
    mock.store(on, { picks: Object.fromEntries(Array.from({ length: 500 }, (_, at) => [idOf(old(at)), QUOTES])) })
    on('model.complete', () => ({ value: ANSWERED }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AssistantMessage' }, engine)

    await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })
    await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    await clock.settle()
    const isPainted = async (text: string) => {
      const ui = await $.ui.mount({
        plugin: 'highlighter',
        surface: 'desktop',
        component: 'AssistantMessage',
        props: { text, isFirstOfReply: true },
      })
      const found = await ui.findAll({ type: 'Text', text: /^Which fix do you want\?$/ })
      await ui.unmount()

      return found.some(text => 'color' in text.props)
    }

    expect(await isPainted(REPLY)).toBe(true)
    expect(await isPainted(old(1))).toBe(true)
    expect(await isPainted(old(0))).toBe(false)
  })

  test('leaves subagent turns, interrupted turns and short replies alone', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    let calls = 0
    on('model.complete', () => {
      calls += 1
      return { value: ANSWERED }
    })
    on('turn.complete', ($, e) => ({ text: e.answer }))

    await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: false, turnId: 'a', agentId: 'agent-1', reason: 'answer' })
    await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: true, turnId: 'b', reason: 'aborted' })
    await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 'c', reason: 'answer' })
    await clock.settle()

    expect(calls).toBe(0)
  })

  test('asks the model the settings name', { options: { model: 'claude-haiku-9' } }, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const models: string[] = []
    on('model.complete', ($, e) => {
      models.push(e.model)
      return { value: ANSWERED }
    })
    on('turn.complete', ($, e) => ({ text: e.answer }))

    await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: false, turnId: 'a', reason: 'answer' })
    await clock.settle()

    expect(models).toEqual(['claude-haiku-9'])
  })

  test("falls back to Claude Code's haiku once the chosen model is gone", async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const models: string[] = []
    const toasts: string[] = []
    const gone: ModelCompleteResult = { isAnswered: false, reason: 'api-error', status: 404, error: 'model_not_found', usage: USAGE }
    on('model.complete', ($, e) => {
      models.push(e.model)
      return { value: e.model === MODEL ? gone : ANSWERED }
    })
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.render', { component: 'AssistantMessage' }, engine)

    await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: false, turnId: 'a', reason: 'answer' })
    await clock.settle()
    await $.turn.complete({ answer: `${REPLY}\nMore.`, durationMs: 1, isAborted: false, turnId: 'b', reason: 'answer' })
    await clock.settle()

    // The second reply goes straight to the fallback.
    expect(models).toEqual([MODEL, ALIAS, ALIAS])
    expect(toasts).toEqual([`Highlighter: ${MODEL} is not available, so Claude Code's ${ALIAS} model picks the highlights`])
    const ui = await $.ui.mount({
      plugin: 'highlighter',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
    })
    const found = await ui.findAll({ type: 'Text', text: /^Which fix do you want\?$/ })

    expect(found.map(text => text.props).find(props => 'color' in props)).toMatchObject(HIGHLIGHT)
    await ui.unmount()
  })

  test('says once when Haiku fails, and leaves the reply as it was', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const toasts: string[] = []
    on('model.complete', () => ({ value: FAILED }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.render', { component: 'AssistantMessage' }, engine)

    await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: false, turnId: 'a', reason: 'answer' })
    await $.turn.complete({ answer: `${REPLY}\nMore.`, durationMs: 1, isAborted: false, turnId: 'b', reason: 'answer' })
    await clock.settle()

    expect(toasts).toEqual([`Highlighter: ${MODEL} failed (overloaded)`])
    const ui = await $.ui.mount({
      plugin: 'highlighter',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
    })
    expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
    await ui.unmount()
  })
})

describe('theme', () => {
  test('draws the dark set when the theme is dark, and recolors when it changes', async ($, on) => {
    mock.store(on)
    let name = 'dark'
    on('config.list', () => themed(name)())
    on('config.set', ($, e) => {
      name = String(e.value)

      return { value: e.value }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.render', { component: 'CommandOutput' }, engine)
    await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })

    const mount = () =>
      $.ui.mount({
        plugin: 'highlighter',
        surface: 'desktop',
        component: 'CommandOutput',
        props: { command: 'highlight-preview', args: '', text: 'Highlight preview', isErrored: false },
      })
    let ui = await mount()
    expect((await ui.find({ type: 'Text', text: /^key result$/ }))?.props.color).toBe(TINT.dark.key)
    expect((await ui.find({ type: 'Text', text: /^warning$/ }))?.props.color).toBe(TINT.dark.warn)
    expect((await ui.find({ type: 'Text', text: /^done and verified$/ }))?.props.color).toBe(TINT.dark.done)
    await ui.unmount()

    await $.config.set({ key: 'theme', value: 'light', previous: name, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
    ui = await mount()
    expect((await ui.find({ type: 'Text', text: /^key result$/ }))?.props.color).toBe(TINT.light.key)
    await ui.unmount()
  })
})

describe('/highlight-preview', () => {
  test('is registered when the session starts', async ($, on) => {
    const registered: string[] = []
    on('command.register', ($, e) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })

    expect(registered).toEqual(['highlight-preview'])
  })

  test('leaves the model one short line', async $ => {
    const { text } = await $.command.run({
      command: 'highlight-preview',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    expect(text).toContain('yellow needs your decision')
  })

  test('draws the legend and a sample reply in the four colors on every surface', async ($, on) => {
    mock.store(on)
    on('config.list', themed('light'))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.render', { component: 'CommandOutput' }, engine)
    await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'highlighter',
        surface,
        component: 'CommandOutput',
        props: { command: 'highlight-preview', args: '', text: 'Highlight preview', isErrored: false },
      })
      const styleOf = async (text: RegExp) =>
        (await ui.findAll({ type: 'Text', text })).map(found => found.props).find(props => 'color' in props)

      expect(await styleOf(/^ needs your decision $/)).toMatchObject(HIGHLIGHT)
      expect(await styleOf(/^Which fix do you want\?$/)).toMatchObject(HIGHLIGHT)
      expect(await styleOf(/^Rewrite the parser: slow, safe\.$/)).toMatchObject(HIGHLIGHT)
      for (const [text, color] of [
        [/^key result$/, '#0066CC'],
        [/^The parser stops at the first tab/, '#0066CC'],
        [/^warning$/, '#C8501B'],
        [/^Running the old export again/, '#C8501B'],
        [/^done and verified$/, '#12A05E'],
        [/^The fix passes all 42 tests\.$/, '#12A05E'],
      ] as const) {
        expect((await styleOf(text))?.color).toBe(color)
      }
      await ui.unmount()
    }
  })

  test("leaves other commands' output to the engine", async ($, on) => {
    on('ui.render', { component: 'CommandOutput' }, engine)

    const ui = await $.ui.mount({
      plugin: 'highlighter',
      surface: 'desktop',
      component: 'CommandOutput',
      props: { command: 'cost', args: '', text: 'Total cost: $0.12', isErrored: false },
    })

    expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
    await ui.unmount()
  })
})
