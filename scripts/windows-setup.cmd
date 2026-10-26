@echo off
setlocal
if not exist "%~dp0runtime\node.exe" (
  echo Please extract the entire ZIP before running setup.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0setup.mjs"
if errorlevel 1 (
  echo Setup failed. Please ensure this folder is writable and the ZIP is fully extracted.
  pause
  exit /b 1
)
echo.
echo Chrome: open chrome://extensions, enable Developer mode, Load unpacked, select extension.
echo MCP: import page-agent-mcp.json or paste the configuration from your clipboard.
pause
