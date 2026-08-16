@echo off
setlocal
cd /d "%~dp0"
title MxGenius Diagnostics Flash Preview

where pwsh.exe >nul 2>nul
if %errorlevel% equ 0 (
  set "MXG_POWERSHELL=pwsh.exe"
) else (
  set "MXG_POWERSHELL=powershell.exe"
)

echo Starting the exact MxGenius diagnostics release preview...
echo.
"%MXG_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\preview-release.ps1" %*
set "MXG_EXIT=%errorlevel%"

if not "%MXG_EXIT%"=="0" (
  echo.
  echo Preview failed with exit code %MXG_EXIT%.
  echo Review the error above, then press any key to close.
  pause >nul
)

endlocal & exit /b %MXG_EXIT%
