@echo off
netstat -ano | findstr ":3100 :3103" > C:\Users\Augi-T1\paperclip\ports.txt
curl -s http://127.0.0.1:3100/api/health >> C:\Users\Augi-T1\paperclip\ports.txt 2>&1
echo. >> C:\Users\Augi-T1\paperclip\ports.txt
curl -s http://127.0.0.1:3103/api/health >> C:\Users\Augi-T1\paperclip\ports.txt 2>&1
