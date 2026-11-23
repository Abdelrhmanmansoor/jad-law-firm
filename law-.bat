@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title لوحة تحكم موقع جاد العبدالله للمحاماة
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 goto :node_manual_install

  color 0E
  cls
  echo.
  echo   ============================================================
  echo.
  echo      لم يتم العثور على Node.js - جاري تثبيته تلقائيًا الآن
  echo.
  echo      إذا ظهرت نافذة صلاحيات من ويندوز (User Account Control)،
  echo      اضغط "نعم" للموافقة على المتابعة.
  echo      يرجى الانتظار ولا تُغلق هذه النافذة.
  echo.
  echo   ============================================================
  echo.
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;C:\Program Files\nodejs\"
  where node >nul 2>nul
  if errorlevel 1 goto :node_manual_install

  color 0A
  cls
  echo.
  echo   ============================================================
  echo.
  echo      تم تثبيت Node.js بنجاح! جاري المتابعة...
  echo.
  echo   ============================================================
  echo.
  timeout /t 2 >nul
  color
  goto :node_ready
)
goto :node_ready

:node_manual_install
color
echo.
echo تعذر تثبيت Node.js تلقائيًا على هذا الجهاز.
echo الرجاء تثبيته يدويًا من الرابط التالي ثم إعادة تشغيل هذا الملف:
echo https://nodejs.org
echo.
pause
exit /b

:node_ready

if not exist node_modules (
  color 0E
  cls
  echo.
  echo   ============================================================
  echo.
  echo      يرجى الانتظار... جاري تثبيت برنامج الإدارة لأول مرة
  echo.
  echo      قد يستغرق هذا دقيقة أو دقيقتين حسب سرعة الإنترنت.
  echo      يرجى عدم إغلاق هذه النافذة حتى تنتهي العملية تلقائيًا.
  echo.
  echo   ============================================================
  echo.
  call npm install --omit=dev --no-save
  color 0A
  cls
  echo.
  echo   ============================================================
  echo.
  echo      تم تثبيت البرنامج بنجاح! جاري فتح لوحة التحكم الآن...
  echo.
  echo   ============================================================
  echo.
  color
)

rem تحديث المكتبات بصمت إذا تغيّرت بعد جلب تحديثات المطور (ثوانٍ قليلة).
call npm install --omit=dev --no-save --no-audit --no-fund --loglevel=error >nul 2>nul

echo جارٍ تشغيل لوحة التحكم...
echo سيتم فتح المتصفح تلقائيًا خلال ثوانٍ...
echo.
echo لإيقاف لوحة التحكم: أغلق هذه النافذة.
echo.

start "" cmd /c "timeout /t 2 >nul && start http://localhost:3000/admin"

call npm run admin

pause
exit /b
