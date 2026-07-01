#!/usr/bin/env bash
set -e
cd /c/Users/Augi-T1/paperclip

export PAPERCLIP_DEPLOYMENT_MODE="local_trusted"
export PAPERCLIP_LOG_DIR="C:/Users/Augi-T1/.paperclip/instances/default/logs"
export PAPERCLIP_STORAGE_LOCAL_DIR="C:/Users/Augi-T1/.paperclip/instances/default/data/storage"
export PAPERCLIP_HOME="C:/Users/Augi-T1/.paperclip"
export PAPERCLIP_ALLOWED_HOSTNAMES=""
export PORT="3100"
export SERVE_UI="true"
export DATABASE_URL="postgres://paperclip@localhost:5432/paperclip"
node ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs server/src/index.ts