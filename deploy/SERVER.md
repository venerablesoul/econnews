# Faster news: the bot on a server or your own computer

On GitHub Actions the bot runs in ~5.5-hour loops restarted by a schedule, and GitHub sometimes starts them late.
In continuous mode on your own machine the bot checks the feeds every 5 minutes (or more often) without gaps.

## Step 0. Turn off the GitHub schedule
Otherwise the news arrives twice.
GitHub → **Actions** tab → **Economic news** → **⋯** → **Disable workflow**.
The Markets page and the terminal keep working: GitHub Pages serves them, and the bot pushes fresh data there itself.

## Option A. A server (VPS) — runs around the clock
The cheapest Linux server is enough (1 core, 512 MB–1 GB of memory, Ubuntu).

1. **A key for pushing data to GitHub.** GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate. Repository access: only `econnews`. Permissions → Contents: **Read and write**. Copy the token.
2. **On the server:**
   ```bash
   sudo apt update && sudo apt install -y git python3 python3-pip
   sudo pip3 install matplotlib pdfplumber --break-system-packages   # charts and trade reports
   sudo useradd -m bot && sudo -iu bot
   git clone https://TOKEN@github.com/venerablesoul/econnews.git
   cd econnews
   cp .env.example .env && nano .env      # fill in the bot token, chat id, FRED key
   python3 news_bot.py --test             # a test message should arrive
   exit
   sudo cp /home/bot/econnews/deploy/econnews.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now econnews
   ```
3. **Check it works:** `journalctl -u econnews -f`. Every 5 minutes a line "candidates: …, sent: …" appears.

## Option B. Your own Windows computer
Works while the computer is on.
1. Install Python from python.org (tick **Add Python to PATH**) and Git from git-scm.com.
2. In the command prompt:
   ```
   git clone https://TOKEN@github.com/venerablesoul/econnews.git
   cd econnews
   copy .env.example .env
   notepad .env
   pip install matplotlib pdfplumber
   ```
3. Run `deploy\start_windows.bat`. To start it with Windows: Win+R → `shell:startup` → put a shortcut to this file there.

## Moving everything back to GitHub Actions
Stop the bot on the server (`sudo systemctl disable --now econnews`) and enable the workflow again: Actions → Economic news → **Enable workflow**.
