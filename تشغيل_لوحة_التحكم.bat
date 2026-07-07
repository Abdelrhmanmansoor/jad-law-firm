@echo off
chcp 65001 >nul
title لوحة تحكم موقع جاد العبدالله للمحاماة
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo تعذر العثور على Node.js على هذا الجهاز.
  echo الرجاء تثبيته أولاً من الرابط التالي ثم إعادة تشغيل هذا الملف:
  echo https://nodejs.org
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo جارٍ تجهيز البرنامج لأول مرة، الرجاء الانتظار قليلاً...
  call npm install
  echo.
)

echo جارٍ تشغيل لوحة التحكم...
echo سيتم فتح المتصفح تلقائيًا خلال ثوانٍ...
echo.
echo لإيقاف لوحة التحكم: أغلق هذه النافذة.
echo.

start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000/admin"

call npm run admin

pause
