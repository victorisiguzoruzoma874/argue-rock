@echo off
rem Starts the dev server when the project folder's path contains a space (for example "new work").
rem The framework's CLI breaks on spaces, so this maps the parent folder to drive R: (no space) and runs
rem from there. The mapping lasts until reboot; running this again re-creates it.
setlocal
set "PROJECT=%~dp0.."
for %%I in ("%PROJECT%") do set "PROJECT=%%~fI"
for %%I in ("%PROJECT%\..") do set "PARENT=%%~fI"
for %%I in ("%PROJECT%") do set "NAME=%%~nxI"
if not exist R:\ subst R: "%PARENT%"
cd /d "R:\%NAME%"
npm run dev
