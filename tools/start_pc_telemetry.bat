@echo off
REM Inicia o reporter de telemetria do Hermes em segundo piano, sem janela.
cd /d "%~dp0.."
start "" /min "venv\Scripts\pythonw.exe" "tools\pc_telemetry_reporter.py"
