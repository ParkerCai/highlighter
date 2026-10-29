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

The colors are fixed and read on light and dark themes alike: blue `#0066CC`, vermilion `#C8501B` and green `#12A05E`. The yellow has dark text on it, so it reads on any theme.

![A reply arrives plain; a few seconds later its highlights land](demo/demo.gif)

## Install

In a terminal session of Claude Code (the desktop app's Code tab does not take this command):

```
/plugin install highlighter --marketplace ParkerCai/highlighter
```

Answer `y` to add the marketplace, then pick the user scope. Installed at the user scope, the mod also runs in the desktop app's Code tab sessions.

## Use

- Highlights appear a few seconds after a reply finishes.
- Run `/highlight-preview` to see what each color means, on a sample reply.

## How it works

```mermaid
flowchart TD
    you([You send a message]) --> main[Main model writes the reply]
    main -->|shown right away| screen[Reply on screen]
    main -.->|reply finishes: turn.complete hook| mod
    subgraph mod [Highlighter mod, which the main model never sees]
        direction LR
        pick[Send your message and the reply to Haiku] --> haiku[Haiku picks exact quotes and a color for each] --> save[(Save the picks: FIFO, last 500 replies kept)] --> paint[Find the quotes and color them]
    end
    mod -.->|a few seconds later: ui.render hook| screen
```

1. When the main model finishes a reply (`turn.complete`), the mod sends your prompt and the reply to Haiku in a separate request, at Haiku's own default effort. It runs on a timer, so the turn is not delayed.
2. Haiku answers with a JSON list of exact quotes, each tagged `decide`, `key`, `warn` or `done`.
3. When the reply is drawn (`ui.render` on `AssistantMessage`), the mod finds each quote by its letters and digits alone, so differences in spacing, case, markdown symbols or list numbers do not matter. Lines with a highlight are drawn by the mod; every other line stays normal markdown.
4. The picks are saved in the mod's store, one small JSON file Claude Code keeps for the mod under `~/.claude/plugins/store/`. When you reopen a chat, each reply is drawn with its saved colors.

### Storage

The store is a FIFO queue, 500 replies deep: each new reply's picks go in at the end, and once there are more than 500, the oldest are deleted. The mod reads the store once when it loads and keeps the picks in memory, because a surface that is kept waiting while a reply is drawn shows its own version of the reply and never comes back for a late answer. The cap is there because Claude Code limits a mod's store to 4 MiB and rewrites the whole file on each save. 500 replies stay under the cap even if every reply had the most picks possible (12 quotes of up to 600 characters each), and take under 200 KB as replies usually run.

Eviction is by age, not by chat. The mod does not record which chat a reply belongs to, so it cannot drop an archived chat's replies as such. It does not need to: archived chats are the old ones, so their replies are the ones that age out. Tracking chats would add code for the same result.

The request goes through the session's own login, the same one the main model uses. No separate API key is needed.

## Model

The `model` setting picks the model, `claude-haiku-5-5` by default. Change it with `/config` in a terminal session when a newer Haiku comes out.

Set it to `haiku` to follow Claude Code's own name for its current Haiku. That name moves to a new Haiku on Claude Code's schedule, which can trail a release, so it is not the default.

If the chosen model is retired or not offered, the mod switches to `haiku` by itself and says so once.

## Cost

A typical reply is about 1,500 input tokens for Haiku, plus a few hundred tokens of thinking and answer: well under a tenth of a cent, or about 5 cents per 100 replies at Haiku 5.5 API prices. On a subscription it counts toward plan usage instead. Replies under 80 characters are skipped.

## Limits

- Only the final reply of a turn is read, not the text between tool calls.
- Code blocks and tables are never highlighted.
- If a Haiku call fails, the reply stays plain, with one notice per session.
- Replies older than the last 500 show plain.

## Files

- `hooks/register.tsx`: the hooks: reading each reply, drawing, and the preview command
- `hooks/select.ts`: the prompt Haiku gets, and how its answer is read
- `hooks/marks.ts`: finds the quotes in a reply and splits it into painted lines
- `hooks/preview.ts`: the sample reply `/highlight-preview` draws
- `tests/highlighter.test.tsx`: the tests

## Develop

The mod is built and tested on Claude Code 2.1.295. Run the tests and checks from this folder:

```
claude plugin test .
claude plugin validate .
```

To run the mod from this folder while you change it:

```
claude --plugin-dir .
```

`tsconfig.json` extends the types Claude Code writes to `.claude-plugin/types/` when it loads the mod. After one load, `tsc -p .` type-checks it.

The demo above is `demo/demo.html`, a page that draws the sample reply at any moment in time. `demo/frames.mjs` renders it frame by frame with Playwright's Chromium and writes `demo.mp4` and `demo.gif` with ffmpeg. To render it again, from `demo/`: `bun install`, then `node frames.mjs` (ffmpeg must be on the PATH, or named in `FFMPEG`).
