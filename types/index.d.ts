/**
 * What a highlight means: needs the person's decision (yellow), the key
 * result (blue), a warning (red), or work done and verified (green).
 */
export type Mark = 'decide' | 'key' | 'warn' | 'done'

/** One part of a reply to highlight, quoted from it, and how. */
export type Quote = { mark: Mark; text: string }

declare module 'claude-code' {
  interface PluginState {
    highlighter: {
      /** The highlights a separate model picked for one reply, by the reply's id. */
      marks: StateFamily<Quote[]>
    }
  }
}
