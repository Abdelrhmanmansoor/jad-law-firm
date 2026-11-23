@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title لوحة تحكم جاد العبدالله
rem ======================================================================
rem  لوحة تحكم جاد العبدالله — تشغيل بضغطة واحدة
rem  يعمل من أي مكان: يجد مجلد الموقع، يحدّثه من GitHub، ثم يفتح اللوحة.
rem  تطوير: solimanx.com
rem ======================================================================

set "REPO=https://github.com/Abdelrhmanmansoor/jad-law-firm.git"
if defined JAD_REPO set "REPO=%JAD_REPO%"
set "SAVED=%APPDATA%\JadAdmin\project-path.txt"
set "JAD_UPDATED="
set "GIT_TERMINAL_PROMPT=0"
set "GCM_INTERACTIVE=never"
set "PATH=%PATH%;C:\Program Files\nodejs;C:\Program Files\Git\cmd"

echo.
echo    جاد العبدالله للمحاماة  ^|  لوحة التحكم
echo    ----------------------------------------
echo.

rem ---------- 1) الأدوات ----------
where git >nul 2>nul || call :install Git.Git "Git"
where node >nul 2>nul || call :install OpenJS.NodeJS.LTS "Node.js"
where git >nul 2>nul || goto :need_tools
where node >nul 2>nul || goto :need_tools

rem ---------- 2) مجلد الموقع ----------
set "ROOT="
call :is_project "%~dp0." && set "ROOT=%~dp0."
if not defined ROOT if exist "%SAVED%" (
  set /p ROOT=<"%SAVED%"
  call :is_project "!ROOT!" || set "ROOT="
)
if not defined ROOT (
  echo    البحث عن ملفات الموقع على الجهاز...
  call :search
)
if not defined ROOT (
  set "ROOT=%USERPROFILE%\Documents\jad-law-firm"
  echo    تنزيل ملفات الموقع لأول مرة...
  git clone --quiet "%REPO%" "!ROOT!" || goto :fail_download
)
for %%I in ("!ROOT!") do set "ROOT=%%~fI"
if not exist "%APPDATA%\JadAdmin" mkdir "%APPDATA%\JadAdmin"
>"%SAVED%" echo !ROOT!
cd /d "!ROOT!"

rem ---------- 3) نقل رمز GitHub القديم من رابط المستودع إلى ملف آمن ----------
set "RURL="
for /f "delims=" %%U in ('git remote get-url origin 2^>nul') do set "RURL=%%U"
echo(!RURL!| findstr /c:"@github.com" >nul && (
  for /f "tokens=2 delims=/@" %%T in ("!RURL!") do set "TOK=%%T"
  for /f "tokens=1,2 delims=:" %%a in ("!TOK!") do if not "%%b"=="" set "TOK=%%b"
  if not exist "data\.github-token" (
    echo(!TOK!| findstr /r /b /c:"gh[pousr]_" /c:"github_pat_" >nul && (
      if not exist data mkdir data
      >"data\.github-token" echo !TOK!
    )
  )
  git remote set-url origin "%REPO%"
)
git config user.email >nul 2>nul || (
  git config user.email "admin@jad-law.local"
  git config user.name "Jad Admin Panel"
)

rem ---------- رمز ربط جديد في ملف TOKEN.txt بجانب هذا الملف؟ يُحفظ تلقائيًا ثم يُحذف ----------
set "NEWTOK="
if exist "%~dp0TOKEN.txt" (
  for /f "usebackq tokens=1" %%T in (`findstr /r /c:"github_pat_[A-Za-z0-9_]*" /c:"ghp_[A-Za-z0-9]*" "%~dp0TOKEN.txt"`) do set "NEWTOK=%%T"
)
if defined NEWTOK (
  echo(!NEWTOK!| findstr /r /b /c:"github_pat_" /c:"ghp_" >nul && (
    if not exist data mkdir data
    >"data\.github-token" echo !NEWTOK!
    del /q "%~dp0TOKEN.txt" >nul 2>nul
    set "JAD_UPDATED=1"
    echo    تم حفظ رمز الربط بنجاح.
  )
)

rem ---------- 4) التحديث والتشغيل ----------
rem كتلة واحدة: يقرؤها ويندوز كاملة قبل التنفيذ، فلا يتأثر إذا حدّث git هذا الملف نفسه.
(
  echo    التحقق من التحديثات...
  git fetch --quiet origin main >nul 2>nul
  if errorlevel 1 (
    echo    لا يوجد إنترنت الآن - سيتم التشغيل بالنسخة الحالية.
  ) else (
    for /f %%B in ('git rev-parse --abbrev-ref HEAD') do if not "%%B"=="main" git checkout --quiet main >nul 2>nul
    set "BEHIND=0"
    for /f %%N in ('git rev-list --count HEAD..origin/main') do set "BEHIND=%%N"
    if not "!BEHIND!"=="0" (
      set "JAD_UPDATED=1"
      echo    تثبيت آخر تحديث...
      git status --porcelain | findstr . >nul && (
        git add -A >nul 2>nul
        git commit --quiet -m "حفظ تلقائي لتعديلات غير منشورة قبل التحديث" >nul 2>nul
      )
      set "AHEAD=0"
      for /f %%N in ('git rev-list --count origin/main..HEAD') do set "AHEAD=%%N"
      if "!AHEAD!"=="0" (
        git merge --ff-only --quiet origin/main >nul 2>nul
      ) else (
        git rebase -X theirs origin/main >nul 2>nul || (
          git rebase --abort >nul 2>nul
          git checkout origin/main -- server tools Jad-Admin.bat law-.bat package.json package-lock.json script.js styles.css index.template.html assets/admin.ico >nul 2>nul
        )
      )
    )
  )

  set "NEED_DEPS="
  if not exist "node_modules\express\package.json" set "NEED_DEPS=1"
  if not exist "node_modules\.jad-lock" set "NEED_DEPS=1"
  if exist "node_modules\.jad-lock" fc /b "package-lock.json" "node_modules\.jad-lock" >nul 2>nul || set "NEED_DEPS=1"
  if defined NEED_DEPS (
    set "JAD_UPDATED=1"
    echo    تجهيز البرنامج - مرة واحدة فقط، قد يستغرق دقيقة...
    call npm install --omit=dev --no-save --no-audit --no-fund --loglevel=error >nul 2>nul
    if exist "node_modules\express\package.json" copy /y "package-lock.json" "node_modules\.jad-lock" >nul
  )

  if exist "tools\start.js" (
    node "tools\start.js"
  ) else (
    start "" /min node "server\server.js"
    "%SystemRoot%\System32\timeout.exe" /t 3 >nul
    start "" "http://localhost:3000/admin"
  )
  if errorlevel 1 (
    echo.
    echo    حدثت مشكلة أثناء التشغيل. للدعم الفني عبر واتساب:
    echo    https://wa.me/201007835547
    echo.
    pause
  ) else (
    "%SystemRoot%\System32\timeout.exe" /t 2 >nul
  )
  exit /b
)

rem ======================================================================
:is_project
if exist "%~1\server\server.js" findstr /c:"jad-law-firm-site" "%~1\package.json" >nul 2>nul && exit /b 0
exit /b 1

:search
for %%B in ("%USERPROFILE%\Desktop" "%USERPROFILE%\OneDrive\Desktop" "%USERPROFILE%\Documents" "%USERPROFILE%\OneDrive\Documents" "%USERPROFILE%\Downloads" "%USERPROFILE%") do (
  if not defined ROOT if exist "%%~B" (
    for /f "delims=" %%F in ('dir /s /b /a:-d "%%~B\server.js" 2^>nul ^| findstr /i /e /c:"\server\server.js" ^| findstr /v /i /c:"node_modules"') do (
      if not defined ROOT (
        set "CAND=%%~dpF.."
        call :is_project "!CAND!" && set "ROOT=!CAND!"
      )
    )
  )
)
exit /b 0

:install
where winget >nul 2>nul || exit /b 1
echo    تثبيت %~2 لأول مرة - إذا طلب ويندوز الإذن اضغطي "نعم"...
winget install --id %~1 -e --silent --accept-package-agreements --accept-source-agreements >nul 2>nul
set "PATH=%PATH%;C:\Program Files\nodejs;C:\Program Files\Git\cmd"
exit /b 0

:need_tools
echo.
echo    تعذّر تثبيت البرامج المطلوبة تلقائيًا.
echo    ثبّتي Node.js من https://nodejs.org و Git من https://git-scm.com
echo    ثم افتحي هذا الملف مرة أخرى.
echo.
pause
exit /b 1

:fail_download
echo.
echo    تعذّر تنزيل ملفات الموقع. تأكدي من اتصال الإنترنت ثم حاولي مرة أخرى.
echo.
pause
exit /b 1
