@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem Runs the bot on a Windows computer. Keep the window open.
rem To start with Windows: Win+R -> shell:startup -> put a shortcut to this file there.
cd /d "%~dp0\.."
:again
python news_bot.py --loop
echo The bot stopped, restarting in 30 seconds...
timeout /t 30 >nul
goto again
