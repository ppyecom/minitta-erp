@echo off
rem Doble clic: arranca PostgreSQL y el ERP, y abre http://localhost:3000
title Minitta ERP
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1" %*
pause
