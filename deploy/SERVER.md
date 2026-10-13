# Быстрые новости: бот на сервере или своём компьютере

На GitHub Actions бот проверяет новости раз в ~30 минут, и GitHub часто опаздывает.
В постоянном режиме бот проверяет ленты каждые 5 минут (можно чаще).

## Шаг 0. Выключите расписание на GitHub
Иначе новости будут приходить дважды.
GitHub → вкладка **Actions** → **Economic news** → **⋯** → **Disable workflow**.
Страница «Рынок онлайн» и терминал продолжат работать: их показывает GitHub Pages, а свежие данные бот будет отправлять туда сам.

## Вариант А. Сервер (VPS) — работает круглосуточно
Подойдёт самый дешёвый Linux-сервер (1 ядро, 512 МБ–1 ГБ памяти, Ubuntu).

1. **Ключ для отправки данных на GitHub.** GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate. Repository access: только `econnews`. Permissions → Contents: **Read and write**. Скопируйте токен.
2. **На сервере:**
   ```bash
   sudo apt update && sudo apt install -y git python3 python3-pip
   sudo pip3 install matplotlib pdfplumber --break-system-packages   # графики и отчёты о сделках
   sudo useradd -m bot && sudo -iu bot
   git clone https://ТОКЕН@github.com/venerablesoul/econnews.git
   cd econnews
   cp .env.example .env && nano .env      # впишите токен бота, chat id, ключ FRED
   python3 news_bot.py --test             # должно прийти тестовое сообщение
   exit
   sudo cp /home/bot/econnews/deploy/econnews.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now econnews
   ```
3. **Проверить работу:** `journalctl -u econnews -f`. Раз в 5 минут появляется строка «кандидатов: …, отправлено: …».

## Вариант Б. Свой компьютер с Windows
Работает, пока компьютер включён.
1. Установите Python с python.org (галочка **Add Python to PATH**) и Git с git-scm.com.
2. В командной строке:
   ```
   git clone https://ТОКЕН@github.com/venerablesoul/econnews.git
   cd econnews
   copy .env.example .env
   notepad .env
   pip install matplotlib pdfplumber
   ```
3. Запустите `deploy\start_windows.bat`. Для автозапуска при включении: Win+R → `shell:startup` → положите туда ярлык на этот файл.

## Как вернуть всё на GitHub Actions
Остановите бота на сервере (`sudo systemctl disable --now econnews`) и включите workflow обратно: Actions → Economic news → **Enable workflow**.
