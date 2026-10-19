# highlighter

A Claude Code mod that colors the parts of Claude's replies you should read first.

After each reply finishes, a separate call to Claude Haiku 5.5 reads it and picks a few exact quotes. The mod then paints them on screen:

| Color | Meaning |
| --- | --- |
| Yellow highlight, bold | Claude is waiting on you: a question only you can answer, a choice to make, or a step only you can take |
| Blue text | The key result: the direct answer, the root cause, or the main finding |
| Red text | A warning: a risk, a breaking change, possible data loss, or something that failed |
| Green text | Done and verified: a fix confirmed, tests passing |

The main model is never told about highlights. Nothing is added to its system prompt or to the saved transcript, so its behavior does not change.

## Install

In a terminal session of Claude Code (the desktop app's Code tab does not take this command):

```
/plugin install highlighter --marketplace ParkerCai/highlighter
```

Answer `y` to add the marketplace, then pick the user scope. Installed at the user scope, the mod also runs in the desktop app's Code tab sessions.

## Use

- Highlights appear 1 to 3 seconds after a reply finishes.
- Run `/highlight-preview` to see what each color means, on a sample reply.

## How it works

1. When the main model finishes a reply (`turn.complete`), the mod sends your prompt and the reply to `claude-haiku-5-5` at effort `low`. It runs on a timer, so the turn is not delayed.
2. Haiku answers with a JSON list of exact quotes, each tagged `decide`, `key`, `warn` or `done`.
3. When the reply is drawn (`ui.render` on `AssistantMessage`), the mod finds each quote by its letters and digits alone, so differences in spacing, case, markdown symbols or list numbers do not matter. Lines with a highlight are drawn by the mod; every other line stays normal markdown.
4. The picks are kept in session state and in the mod's store for the last 400 replies, so highlights survive a restart.

## Cost

A typical reply is about 1,500 input and 200 output tokens for Haiku: roughly $0.0003, or about 3 cents per 100 replies at Haiku 5.5 API prices. On a subscription it counts toward plan usage instead. Replies under 80 characters are skipped.

## Limits

- Only the final reply of a turn is read, not the text between tool calls.
- Code blocks and tables are never highlighted.
- If a Haiku call fails, the reply stays plain, with one notice per session.

## Files

- `hooks/register.tsx`: the hooks: reading each reply, drawing, and the preview command
- `hooks/select.ts`: the prompt Haiku gets, and how its answer is read
- `hooks/marks.ts`: finds the quotes in a reply and splits it into painted lines
- `hooks/preview.ts`: the sample reply `/highlight-preview` draws
- `types/index.d.ts`: the mod's state contract
- `tests/highlighter.test.tsx`: the tests

## Develop

The mod needs Claude Code 2.1.295 or later; older builds have no `$.state`. Run the tests and checks from this folder:

```
claude plugin test .
claude plugin validate .
```

To run the mod from this folder while you change it:

```
claude --plugin-dir .
```

`tsconfig.json` extends the types Claude Code writes to `.claude-plugin/types/` when it loads the mod. After one load, `tsc -p .` type-checks it.
