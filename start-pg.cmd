@echo off
title Postgres 5432 - DO NOT CLOSE THIS WINDOW
"C:\Users\Augi-T1\.hermes\postgresql\pgsql\bin\pg_ctl.exe" -D "C:\Users\Augi-T1\.hermes\postgresql\data" -l "C:\Users\Augi-T1\.hermes\postgresql\logfile" -o "-p 5432" -w -t 60 start
echo.
echo Postgres start attempted. LEAVE THIS WINDOW OPEN - closing it can kill Postgres.
pause >nul
