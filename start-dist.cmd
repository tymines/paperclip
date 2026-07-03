@echo off
set PAPERCLIP_HOME=C:\Users\Augi-T1\.paperclip
set PAPERCLIP_DEPLOYMENT_MODE=local_trusted
set DATABASE_URL=postgres://paperclip@localhost:5432/paperclip
set NODE_ENV=development
cd /d C:\Users\Augi-T1\paperclip\server
C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe dist\index.js
