@echo off
setlocal
title AquaRoute - Live Reload
color 0e

REM ====== CONFIG ======
set "PROJECT_DIR=C:\Users\Lenovo Ideapad\aquaroute-app"
set "HOST=0.0.0.0"
set "PORT=8101"
REM Optional: auto-start emulator
set "AVD_NAME=Medium_Phone_API_36.0"
set "ANDROID_SDK=%LOCALAPPDATA%\Android\Sdk"
REM =====================

echo.
echo 🔁 Starting AquaRoute (live reload)...
echo --------------------------------------

REM 1) Sanity checks
where node >nul 2>nul || (echo ❌ Node.js not found in PATH & pause & exit /b 1)
where ionic >nul 2>nul || (echo ❌ Ionic CLI not found. Run: npm i -g @ionic/cli & pause & exit /b 1)
where java >nul 2>nul || (echo ❌ Java not found in PATH (need JDK 21). & pause & exit /b 1)

REM Locate adb/emulator
set "ADB=%ANDROID_SDK%\platform-tools\adb.exe"
set "EMULATOR=%ANDROID_SDK%\emulator\emulator.exe"
if not exist "%ADB%" (
  echo ⚠️ ADB not found at "%ADB%". Trying common default...
  set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
)
if not exist "%EMULATOR%" (
  echo ⚠️ Emulator not found at "%EMULATOR%". Trying common default...
  set "EMULATOR=%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe"
)

REM 2) Go to project
cd /d "%PROJECT_DIR%" || (echo ❌ Project folder not found: "%PROJECT_DIR%" & pause & exit /b 1)

REM 3) Optional: ensure emulator is running
if defined AVD_NAME (
  echo 📱 Ensuring emulator "%AVD_NAME%" is running...
  if exist "%EMULATOR%" (
    for /f "tokens=1" %%D in ('"%ADB%" devices ^| findstr /r /c:"^emulator-[0-9][0-9]*[[:space:]]device"') do set "EMU_RUNNING=1"
    if not defined EMU_RUNNING (
      start "" "%EMULATOR%" -avd "%AVD_NAME%" -netdelay none -netspeed full
      echo ⏳ Waiting for emulator to boot (adb wait-for-device)...
      "%ADB%" wait-for-device
      timeout /t 10 >nul
    )
  ) else (
    echo ⚠️ Emulator.exe not found. Skipping auto-start.
  )
)

REM 4) Sync native project (keeps Android in sync with web code)
echo 🔄 Syncing Capacitor Android...
ionic capacitor sync android
if errorlevel 1 (echo ❌ Sync failed & pause & exit /b 1)

REM 5) (Emulator only) Map device port -> host dev server for reliability
if exist "%ADB%" (
  echo 🔌 Setting ADB reverse tcp:%PORT%...
  "%ADB%" reverse tcp:%PORT% tcp:%PORT% >nul 2>nul
)
		
REM 6) Live run
echo ▶️ Running app with live reload on %HOST%:%PORT% ...
ionic capacitor run android -l --external --host=%HOST% --port=%PORT%

echo.
echo ✅ Live run finished (or stopped).
pause
