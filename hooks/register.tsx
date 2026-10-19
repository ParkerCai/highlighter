import type { EngineInterface, ModelCompleteResult, Register, ResolveInput, TextProps } from 'claude-code'

import type { Quote } from '../types'
import { plan } from './marks'
import type { Block, Line, Mark, Span } from './marks'
import { LEGEND, PREVIEW, SAMPLE, SAMPLE_QUOTES } from './preview'
import { ALIAS, MODEL, SELECT, ask, idOf, isQuotes, readQuotes } from './select'

// Yellow alone is a highlighter, in bold so the dark text on it does not read
// thin. The other marks only tint the text: soft colors for a dark theme, each
// at least 5.9:1 on its background.
const STYLE: Record<Mark, TextProps> = {
  decide: { backgroundColor: '#FFE066', color: '#111111', bold: true },
  key: { color: '#8DB7ED' },
  warn: { color: '#DC8D7D' },
  done: { color: '#8CD6BA' },
}

const MARKS = { plugin: 'highlighter', key: 'marks' } as const

// The store keeps each reply's highlights past the session under this prefix,
// the oldest dropped past KEEP.
const SAVED = 'marks:'
const KEEP = 400

// A reply shorter than this has nothing to find first.
const SHORT = 80

// The ids of the replies the store holds, read once per load.
let saved: Promise<Set<string>> | undefined
let isWarned = false
// Set once the chosen model turned out to be gone, for the rest of the load.
let isFallingBack = false

function savedIds($: EngineInterface): Promise<Set<string>> {
  saved ??= $.store.keys().then(
    keys => new Set(keys.filter(key => key.startsWith(SAVED)).map(key => key.slice(SAVED.length))),
    () => new Set<string>(),
  )

  return saved
}

/** A reply's highlights: this session's, else those the store kept. */
async function highlightsOf($: EngineInterface, id: string): Promise<readonly Quote[] | undefined> {
  const { value } = await $.state.get({ ...MARKS, id })
  if (value !== undefined) return value
  if (!(await savedIds($)).has(id)) return undefined
  const stored = await $.store.get(SAVED + id)

  return isQuotes(stored) ? stored : undefined
}

function warn($: EngineInterface, text: string): void {
  if (isWarned) return
  isWarned = true
  $.ui.toast(`Highlighter: ${text}`)
}

/**
 * One call to the model, at its own default effort; undefined when the engine
 * refused to send it (a model it does not offer, say).
 */
async function complete(
  $: EngineInterface,
  model: string,
  request: string,
  reply: string,
): Promise<ModelCompleteResult | undefined> {
  try {
    return await $.model.complete({
      model,
      system: SELECT,
      prompt: ask(request, reply),
      // Room for the model's thinking as well as its answer.
      maxTokens: 4000,
      timeoutMs: 30_000,
    })
  } catch {
    return undefined
  }
}

const isGone = (result: ModelCompleteResult | undefined) =>
  result === undefined ||
  (!result.isAnswered && result.reason === 'api-error' && (result.error === 'model_not_found' || result.status === 404))

/**
 * Asks the separate model what to highlight in a finished reply and keeps its
 * picks, which draws the reply again wherever it is drawn. A chosen model that
 * is retired or not offered gives way to Claude Code's own Haiku.
 */
async function select($: EngineInterface, model: string, request: string, reply: string): Promise<void> {
  let used = isFallingBack ? ALIAS : model
  let result = await complete($, used, request, reply)
  if (used !== ALIAS && isGone(result)) {
    isFallingBack = true
    warn($, `${model} is not available, so Claude Code's ${ALIAS} model picks the highlights`)
    used = ALIAS
    result = await complete($, used, request, reply)
  }
  if (result === undefined) {
    warn($, `could not ask ${used}`)
    return
  }
  if (!result.isAnswered) {
    if (result.reason === 'api-error') warn($, `${used} failed (${result.error})`)
    return
  }
  const quotes = readQuotes(result.text)
  if (quotes.length === 0) return

  const id = idOf(reply)
  await $.state.set({ ...MARKS, id }, quotes)
  try {
    await $.store.set(SAVED + id, quotes)
    ;(await savedIds($)).add(id)
    const keys = (await $.store.keys()).filter(key => key.startsWith(SAVED))
    for (const key of keys.slice(0, -KEEP)) await $.store.delete(key)
  } catch {
    // Kept for this session alone.
  }
}

/** A planned reply's rows, drawn with the elements of the surface `e` names. */
function rows($: EngineInterface, e: ResolveInput, blocks: readonly Block[]) {
  const { Box, Link, Markdown, Text } = $.ui.resolve(e)

  const span = (s: Span) => {
    const style: TextProps = s.mark ? { ...STYLE[s.mark] } : {}
    if (s.bold) style.bold = true
    if (s.italic) style.italic = true
    if (s.strike) style.strikethrough = true
    if (s.code && !s.mark) style.color = 'permission'
    const text = <Text {...style}>{s.text}</Text>

    return s.href ? <Link href={s.href}>{text}</Link> : text
  }

  const row = (line: Line) => {
    const text = <Text>{line.spans.map(span)}</Text>
    switch (line.kind) {
      case 'heading':
        return <Text bold>{line.spans.map(span)}</Text>
      case 'item':
        return (
          <Box flexDirection="row" paddingLeft={line.indent}>
            <Box flexShrink={0} minWidth={line.bullet.length + 1}>
              <Text>{line.bullet}</Text>
            </Box>
            <Box flexShrink={1}>{text}</Box>
          </Box>
        )
      case 'quote':
        return (
          <Box flexDirection="row">
            <Box flexShrink={0} minWidth={2}>
              <Text dimColor>│</Text>
            </Box>
            <Box flexShrink={1}>{text}</Box>
          </Box>
        )
      case 'para':
        return <Box paddingLeft={line.indent}>{text}</Box>
    }
  }

  return blocks.map(block =>
    block.kind === 'markdown' ? (
      <Markdown text={block.text} />
    ) : block.kind === 'line' ? (
      row(block.line)
    ) : (
      <Text> </Text>
    ),
  )
}

export const register: Register = (on, options) => {
  // The settings may name another model, such as a newer Haiku.
  const model = typeof options.model === 'string' && options.model.trim() !== '' ? options.model.trim() : MODEL
  // What each running turn was asked, for the model that reads its reply.
  const requests = new Map<string, string>()

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: PREVIEW,
        description: 'Show what each highlight color means, on a sample reply',
        immediate: true,
      })
    } catch {
      // The highlights work without the command.
    }

    return next(e)
  })

  // The model reads this one line; the person sees the preview drawn in its place.
  on('command.run', { command: 'highlight-preview' }, () => ({
    text: 'Highlight preview: yellow needs your decision, blue is the key result, red is a warning, green is done and verified.',
  }))

  on('turn.start', ($, e, next) => {
    requests.set(e.turnId, e.text)

    return next(e)
  })

  // Once the session's own model has answered, a separate model reads the
  // reply and picks what to highlight. Nothing is added to the session's
  // prompt or transcript: the picks live beside it, by the reply's id.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const request = requests.get(e.turnId) ?? ''
    requests.delete(e.turnId)

    const isReply = e.agentId === undefined && e.reason === 'answer' && e.answer.trim().length >= SHORT
    // On a timer, so the turn ends now and the reading runs beside it.
    if (isReply) $.clock.after(0, () => void select($, model, request, e.answer))

    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const quotes = await highlightsOf($, idOf(e.props.text))
    const blocks = quotes === undefined ? null : plan(e.props.text, quotes)
    if (blocks === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const body = rows($, e, blocks)

    // The terminal's own row opens a reply with a bullet in a 2-column gutter.
    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="row" marginTop={1}>
          <Box flexShrink={0} minWidth={2}>
            <Text>{e.props.isFirstOfReply ? '●' : ' '}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            {body}
          </Box>
        </Box>
      )
    }

    return <Box flexDirection="column">{body}</Box>
  })

  // The preview draws in place of the command's output row: the legend, then
  // the sample reply painted as a reply is.
  on('ui.render', { component: 'CommandOutput', props: { command: 'highlight-preview' } }, async ($, e, next) => {
    const blocks = plan(SAMPLE, SAMPLE_QUOTES)
    if (e.props.isErrored || blocks === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const legend = LEGEND.flatMap(([mark, label], at) => [
      ...(at > 0 ? ['   '] : []),
      <Text {...STYLE[mark]}>{mark === 'decide' ? ` ${label} ` : label}</Text>,
    ])

    return (
      <Box flexDirection="column" paddingLeft={e.surface === 'terminal' ? 2 : 0}>
        <Text dimColor>Highlight preview: what each color means, on a sample reply.</Text>
        <Text>{legend}</Text>
        <Text> </Text>
        {rows($, e, blocks)}
      </Box>
    )
  })
}
