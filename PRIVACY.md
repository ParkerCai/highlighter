# Privacy

Highlighter is a mod that runs inside Claude Code on your machine. It has no server of its own, and its author receives no data from it.

## What it sends

When a reply finishes, the mod sends your message and that reply to a Claude model (Haiku by default) so the model can pick what to highlight. `/highlight` sends the last few replies the same way.

The request goes through Claude Code's own model call, on the login your session already uses. It reaches the same Anthropic service as the rest of your session, and Anthropic's privacy policy covers it. Nothing is sent to any other service.

## What it stores

The quotes the model picked, for the last 500 replies. They are exact lines from replies, so they hold whatever those lines held. They are kept in the mod's store, a file Claude Code keeps on your machine, and the oldest are dropped once there are more than 500 replies.

## What it reads

When the color set is `auto`, the mod looks up whether you use a light or dark theme. It reads Claude Code's `theme` setting, then the theme value in the desktop app's `config.json`, then the operating system's light or dark setting (`reg query` on Windows, `defaults read` on macOS). None of this is sent or stored.

## Questions

Open an issue at https://github.com/ParkerCai/highlighter/issues.
