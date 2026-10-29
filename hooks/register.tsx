import type { EngineInterface, ModelCompleteResult, Register, ResolveInput, TextProps } from 'claude-code'

import { plan } from './marks'
import type { Block, Line, Mark, Quote, Span } from './marks'
import { LEGEND, PREVIEW, SAMPLE, SAMPLE_QUOTES } from './preview'
import { ALIAS, MODEL, SELECT, ask, idOf, isQuotes, readQuotes } from './select'

// Yellow alone is a highlighter, in bold so the dark text on it does not read
// thin; its own dark text keeps it readable on any theme.
const DECIDE: TextProps = { backgroundColor: '#FFE066', color: '#111111', bold: true }

export type Theme = 'light' | 'dark'

// The other marks only tint the text, in one set per theme: deep tones that
// read on white, softer ones on a dark background.
export const TINT: Record<Theme, Record<Exclude<Mark, 'decide'>, string>> = {
  light: { key: '#0066CC', warn: '#C8501B', done: '#12A05E' },
  dark: { key: '#4A9BE8', warn: '#E57F58', done: '#3DBF7E' },
}

// The theme the colors are drawn for, found when the session starts.
let theme: Theme = 'dark'
// The mod's own `theme` setting when it names one, over what is found.
let chosen: string | undefined

const styleOf = (mark: Mark): TextProps => (mark === 'decide' ? { ...DECIDE } : { color: TINT[theme][mark] })

/** `light` or `dark` from a theme's name, or nothing for `auto` and the rest. */
function themeNamed(name: unknown): Theme | undefined {
  if (typeof name !== 'string') return undefined
  if (name.startsWith('light')) return 'light'
  if (name.startsWith('dark')) return 'dark'

  return undefined
}

// Claude Code's own theme setting names the theme, unless it is `auto`. Then
// the desktop app follows its own appearance setting, and `system` there
// follows the operating system, so the mod reads those in turn.
async function findTheme($: EngineInterface): Promise<Theme> {
  const named = themeNamed(chosen)
  if (named) return named

  try {
    const row = (await $.config.list()).find(row => row.key === 'theme')
    const found = themeNamed(row?.value)
    if (found) return found
  } catch {
    // Not every host lists its settings; the app and the system are next.
  }

  let appData: string | undefined
  let home: string | undefined
  try {
    appData = await $.env.get('APPDATA')
    home = await $.env.get('HOME')
  } catch {
    // No environment to read: the system check below still runs.
  }
  const files = [
    ...(appData ? [`${appData}/Claude/config.json`] : []),
    ...(home ? [`${home}/Library/Application Support/Claude/config.json`, `${home}/.config/Claude/config.json`] : []),
  ]
  for (const file of files) {
    try {
      const config: unknown = JSON.parse(await $.fs.read(file))
      const found = themeNamed(isRecord(config) ? config.userThemeMode : undefined)
      if (found) return found
      break
    } catch {
      // Not there: the next place, or the system.
    }
  }

  try {
    if (appData) {
      const { stdout } = await $.process.run([
        'reg',
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        '/v',
        'AppsUseLightTheme',
      ])

      return /0x1\b/.test(stdout) ? 'light' : 'dark'
    }
    const { exitCode, stdout } = await $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'])

    return exitCode === 0 && stdout.includes('Dark') ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

async function applyTheme($: EngineInterface): Promise<void> {
  const found = await findTheme($)
  if (found === theme) return
  theme = found
  $.ui.invalidate('ui.render')
}

// Every reply's highlights, by the reply's id, are saved together under this
// key in the mod's store, a JSON file Claude Code keeps for the mod, so a
// reopened chat shows them again. The store is capped at 4 MiB and rewritten
// whole on each save, so past KEEP replies the oldest go. A reply's picks are
// at most 12 quotes of 600 characters, under 8 KB, so 500 replies stay under
// the cap at the worst and near 200 KB as replies usually run.
const PICKS = 'picks'
const KEEP = 500
// Versions before 0.12 saved each reply under its own key, with this prefix.
const LEGACY = 'marks:'

// A reply shorter than this has nothing to find first.
const SHORT = 80

// The saved picks, read once per load. A draw must be answered at once, so it
// reads this and never the store.
const picks = new Map<string, readonly Quote[]>()
let loading: Promise<void> | undefined
let isWarned = false
// Set once the chosen model turned out to be gone, for the rest of the load.
let isFallingBack = false

function warn($: EngineInterface, text: string): void {
  if (isWarned) return
  isWarned = true
  $.ui.toast(`Highlighter: ${text}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Reads the saved picks into memory, once, and redraws once they are in. */
function load($: EngineInterface): Promise<void> {
  loading ??= (async () => {
    try {
      const stored = await $.store.get(PICKS)
      if (isRecord(stored)) {
        for (const [id, quotes] of Object.entries(stored)) if (isQuotes(quotes)) picks.set(id, quotes)
      }
      // Picks an earlier version saved one key per reply move under PICKS.
      const legacy = (await $.store.keys()).filter(key => key.startsWith(LEGACY))
      for (const key of legacy) {
        const quotes = await $.store.get(key)
        const id = key.slice(LEGACY.length)
        if (isQuotes(quotes) && !picks.has(id)) picks.set(id, quotes)
        await $.store.delete(key)
      }
      if (legacy.length > 0) await write($)
    } catch {
      // The picks of this load alone, then.
    }
    $.ui.invalidate('ui.render')
  })()

  return loading
}

/** Writes the picks in memory to the store, the oldest dropped past KEEP. */
async function write($: EngineInterface): Promise<void> {
  while (picks.size > KEEP) {
    const oldest = picks.keys().next().value
    if (oldest === undefined) break
    picks.delete(oldest)
  }
  try {
    await $.store.set(PICKS, Object.fromEntries(picks))
  } catch {
    warn($, 'could not save the highlights')
  }
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
 * Asks the separate model what to highlight in a finished reply: its quotes,
 * or none when it picked nothing or could not be asked. A chosen model that is
 * retired or not offered gives way to Claude Code's own Haiku.
 */
async function select($: EngineInterface, model: string, request: string, reply: string): Promise<Quote[]> {
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
    return []
  }
  if (!result.isAnswered) {
    if (result.reason === 'api-error') warn($, `${used} failed (${result.error})`)
    return []
  }

  return readQuotes(result.text)
}

/** A planned reply's rows, drawn with the elements of the surface `e` names. */
function rows($: EngineInterface, e: ResolveInput, blocks: readonly Block[]) {
  const { Box, Link, Markdown, Text } = $.ui.resolve(e)

  const span = (s: Span) => {
    const style: TextProps = s.mark ? styleOf(s.mark) : {}
    if (s.bold) style.bold = true
    if (s.italic) style.italic = true
    if (s.strike) style.strikethrough = true
    if (s.code && !s.mark) style.color = 'ide'
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

  chosen = typeof options.theme === 'string' ? options.theme : undefined

  on('session.start', async ($, e, next) => {
    await load($)
    void applyTheme($).catch(() => undefined)
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

  // A theme change in /config, Claude Code's own or this mod's, recolors.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    void applyTheme($).catch(() => undefined)

    return result
  })
  on('config.set', { key: 'highlighter.theme' }, async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) chosen = typeof e.value === 'string' ? e.value : undefined
    void applyTheme($).catch(() => undefined)

    return result
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
  // prompt or transcript.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const request = requests.get(e.turnId) ?? ''
    requests.delete(e.turnId)

    const isReply = e.agentId === undefined && e.reason === 'answer' && e.answer.trim().length >= SHORT
    // On a timer, so the turn ends now and the reading runs beside it. Once
    // the picks are in, the replies are drawn again, and the one they belong
    // to shows them.
    if (isReply) {
      $.clock.after(0, async () => {
        const quotes = await select($, model, request, e.answer)
        if (quotes.length === 0) return
        await load($)
        picks.set(idOf(e.answer), quotes)
        await write($)
        $.ui.invalidate('ui.render')
      })
    }

    return result
  })

  // Answered at once, from memory: a surface draws its own version of a reply
  // when a hook keeps it waiting, and does not come back for a late answer.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (loading === undefined) void load($)
    const quotes = e.props.isSummary ? undefined : picks.get(idOf(e.props.text))
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
  on('ui.render', { component: 'CommandOutput', props: { command: 'highlight-preview' } }, ($, e, next) => {
    const blocks = plan(SAMPLE, SAMPLE_QUOTES)
    if (e.props.isErrored || blocks === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const legend = LEGEND.flatMap(([mark, label], at) => [
      ...(at > 0 ? ['   '] : []),
      <Text {...styleOf(mark)}>{mark === 'decide' ? ` ${label} ` : label}</Text>,
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
