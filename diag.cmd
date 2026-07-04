@echo off
echo === DIAG %date% %time% === > C:\Users\Augi-T1\paperclip\diag.txt
echo --- ports 3100/3103 --- >> C:\Users\Augi-T1\paperclip\diag.txt
netstat -ano | findstr ":3100 :3103" >> C:\Users\Augi-T1\paperclip\diag.txt
echo --- cloudflared procs --- >> C:\Users\Augi-T1\paperclip\diag.txt
tasklist | findstr /i cloudflared >> C:\Users\Augi-T1\paperclip\diag.txt
echo --- health 3100 --- >> C:\Users\Augi-T1\paperclip\diag.txt
curl -s -m 5 http://127.0.0.1:3100/api/health >> C:\Users\Augi-T1\paperclip\diag.txt 2>&1
echo. >> C:\Users\Augi-T1\paperclip\diag.txt
echo --- public via tunnel --- >> C:\Users\Augi-T1\paperclip\diag.txt
curl -s -m 8 -o nul -w "HTTP %%{http_code}" https://paperclip.augiport.com/api/health >> C:\Users\Augi-T1\paperclip\diag.txt 2>&1
echo. >> C:\Users\Augi-T1\paperclip\diag.txt
