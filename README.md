# Economic news bot

A Telegram bot with economy-moving news (English / Russian), a «Markets» page and a Bloomberg-style terminal.

## How it runs

| Part | Where | What it does |
|---|---|---|
| `news_bot.py` | GitHub Actions, workflow **Economic news** (`news.yml`) | checks the news every 5 minutes, sends them, builds the data for the site and the terminal |
| `gh-pages` branch | GitHub Pages | the site (`docs/`) plus the bot's data and memory (`state.json`) — **one commit, replaced on every save**, so it never grows a history (main keeps only code) |
| `worker/` | Cloudflare Workers | answers `/start` and commands instantly, keeps the subscribers, live quotes; watches that the news bot is alive |

## It keeps itself running

- **No gaps between sessions.** A GitHub Actions job lives at most 6 hours, so the bot runs in ~5.5-hour sessions.
  Each session queues the next one itself after its first good check (`relay.py`); the next one waits and starts the
  moment the current one ends, also when it dies. GitHub's schedule is not relied on: a `*/30` schedule fired only
  every 4–8 hours here, which left the bot silent for up to 2.5 hours.
- **Safety net.** `keepalive.yml` starts a session if none runs or waits, and keeps the workflows from being switched
  off for inactivity. It never starts a second copy and never touches a workflow disabled by hand.
- **Broken code is not taken.** New code from main is used only after `python news_bot.py --selfcheck` passes (an
  offline run on made-up news). If main is broken, the bot stays on (or starts from) the last version that worked —
  `code_ok` in `state.json` — and picks up the next fixed commit by itself.
- **One failure does not stop the rest.** Each part of a run (news, digests, reminders, trades, …) stands on its own;
  a message Telegram refuses is not retried forever; a run that hangs for 30 minutes is restarted.

## When you hear from it

Only when it cannot fix things itself:

| Message | Meaning |
|---|---|
| «New code on GitHub does not start» | a commit on main fails the self-check; the bot runs the previous version until a fix lands |
| «Part of the bot is broken» | one feature keeps failing (a bug); everything else works. Once a day at most |
| «The news bot keeps failing» | whole runs fail for 30+ minutes (e.g. a revoked token); it keeps retrying |
| «The news bot has gone quiet» (from the bot server) | no updates for 60 min and no self-restart: the workflow is disabled or GitHub Actions is down |
| «Not responding for ~3 h: …» | a news source has been down for 3 hours (and «Back online» when it returns) |

## Turning it off and on

- **Off:** GitHub → Actions → Economic news → ⋯ → **Disable workflow**. The running session notices within ~30 minutes.
- **On:** the same menu → **Enable workflow**, then **Run workflow** once.

## Checks

```bash
python3 -m unittest discover -s tests -p "test_*.py"   # the news bot, the relay, the self-healing (no network)
node tests/worker.test.mjs                             # the bot server
python3 news_bot.py --selfcheck                        # this copy of the bot works
```

Running it on your own server or computer instead: `deploy/SERVER.md`.
