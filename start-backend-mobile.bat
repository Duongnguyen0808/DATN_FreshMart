@echo off
title FreshMart Full Stack Launcher (Tunnel + Backend + Web + AI + Mobile)
echo ====================================================================
echo   Dang khoi dong toan bo he thong FreshMart...
echo   (Cloudflare Tunnel + Backend + Web Admin + AI + Mobile App)
echo ====================================================================

start "FreshMart Core (Tunnel + Backend + Web + AI)" cmd /k "cd /d %~dp0 && npm run dev"
timeout /t 3 /nobreak >nul
start "FreshMart Mobile App (Expo)" cmd /k "cd /d %~dp0mobile-app && npx expo start"

echo Da khoi dong xong toan bo he thong!
