# A relay for networks that block *.workers.dev

Russian providers throttle Cloudflare: a connection stops after ~16 KB (checked 06.11.2026 from a Moscow network:
port 443 hung for 15–25 s while fresh connections on 8443/2053/2083/2087/2096 answered in 0.7 s; on 23.10.2026 some
connections were reset outright). The terminal already copes with this by itself — it spreads its requests over these
ports and repeats a stalled one on another (`wjson` in `docs/terminal/index.html`), and everything on the screen comes
from the bot's data on GitHub Pages first, which is not throttled.

The relay below is for the worse case: a provider that blocks every port of `*.workers.dev`. The bot itself is not
affected — Telegram reaches the server from abroad — but then the terminal opened from Russia shows only the bot's
data from the site: no live quotes, company cards beyond the ~100 largest, search, charts or the personal lists.

The fix is a one-file relay on any ordinary PHP hosting (terminalbloom.com is on Namecheap hosting). The browser asks
`https://terminalbloom.com/api/...`, the hosting asks the bot server and returns the answer. No keys are stored there.

## Install (5 minutes, once)

1. Namecheap → Hosting List → **Go to cPanel** → **File Manager** → open `public_html`.
2. Create a folder `api` and put the two files from `deploy/hosting/api/` in it:
   `index.php` and `.htaccess` (the second is hidden: File Manager → Settings → Show Hidden Files).
   Either upload them or create them with **+ File** and paste the text.
3. Open `https://terminalbloom.com/api/ping` — it must show `{"ok":true,"service":"econnews-bot",...}`.

Then add the address to `api_alt` in `docs/config.json` — only a domain you own: the terminal sends the viewer's sign-in headers there. Every viewer's terminal asks
all addresses at once and keeps the first that answers, so viewers abroad stay on workers.dev and viewers in Russia
switch to the relay by themselves.

## If something goes wrong
- `/api/ping` shows 404 or the file text → the `.htaccess` is missing, or PHP is off for the folder.
- `{"ok":false,"error":"relay: ..."}` → the hosting cannot reach Cloudflare; ask the host to allow outgoing HTTPS.
- Another domain or hosting: change nothing in the files, just add its address to `api_alt` in `docs/config.json`.
- Even with no relay, the company card of the ~100 largest US companies opens from the copy on the site (docs/co).
