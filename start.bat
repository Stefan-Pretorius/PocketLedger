@echo off
echo Building PocketLedger...
call npx vite build
if %ERRORLEVEL% neq 0 (echo Build failed! & pause & exit /b 1)
echo Starting PocketLedger at http://localhost:4173
start http://localhost:4173
npx vite preview --host --port 4173
pause
