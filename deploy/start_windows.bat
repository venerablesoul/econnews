@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem Запуск бота на компьютере с Windows. Окно должно оставаться открытым.
rem Для автозапуска: Win+R -> shell:startup -> положите туда ярлык на этот файл.
cd /d "%~dp0\.."
:again
python news_bot.py --loop
echo Бот остановился, перезапуск через 30 секунд...
timeout /t 30 >nul
goto again
