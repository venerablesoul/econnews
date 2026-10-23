# A relay for networks that block *.workers.dev

Several Russian providers reset every connection to `*.workers.dev` (checked 23.10.2026: even a tiny `/api/ping`
fails with ERR_CONNECTION_RESET). The bot itself is not affected — Telegram reaches the server from abroad — but the
terminal opened from Russia cannot get quotes, company cards, search, charts or the personal lists.

The fix is a one-file relay on any ordinary PHP hosting (terminalbloom.com is on Namecheap hosting). The browser asks
`https://terminalbloom.com/api/...`, the hosting asks the bot server and returns the answer. No keys are stored there.

## Install (5 minutes, once)

1. Namecheap → Hosting List → **Go to cPanel** → **File Manager** → open `public_html`.
2. Create a folder `api` and put the two files from `deploy/hosting/api/` in it:
   `index.php` and `.htaccess` (the second is hidden: File Manager → Settings → Show Hidden Files).
   Either upload them or create them with **+ File** and paste the text.
3. Open `https://terminalbloom.com/api/ping` — it must show `{"ok":true,"service":"econnews-bot",...}`.

That is all: `docs/config.json` already lists `https://terminalbloom.com` in `api_alt`. Every viewer's terminal asks
all addresses at once and keeps the first that answers, so viewers abroad stay on workers.dev and viewers in Russia
switch to the relay by themselves.

## If something goes wrong
- `/api/ping` shows 404 or the file text → the `.htaccess` is missing, or PHP is off for the folder.
- `{"ok":false,"error":"relay: ..."}` → the hosting cannot reach Cloudflare; ask the host to allow outgoing HTTPS.
- Another domain or hosting: change nothing in the files, just add its address to `api_alt` in `docs/config.json`.
- Even with no relay, the company card of the ~100 largest US companies opens from the copy on the site (docs/co).
