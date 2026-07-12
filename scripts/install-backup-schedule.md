# Paperclip off-drive backups — install the schedule

`scripts/backup-to-vault.sh` dumps the DB (via the app's own backup engine) and
copies every backup to the **vault drive** `F:\Augi Vault\06 - Projects\Paperclip DB Backups\`
— a separate disk that syncs off-machine — then prunes anything older than 30 days.
This protects backups from the "instance setup required" wipe (which destroys the
in-instance `~/.paperclip/.../data/backups` copies).

## Run it once manually (safe anytime the server is up)

```bash
bash /c/Users/Augi-T1/paperclip/scripts/backup-to-vault.sh
```

## Register the 3-hour schedule (run once, in an elevated PowerShell or cmd)

```cmd
schtasks /Create /TN "Paperclip Vault Backup" ^
  /TR "\"C:\Program Files\Git\bin\bash.exe\" -lc \"/c/Users/Augi-T1/paperclip/scripts/backup-to-vault.sh\"" ^
  /SC HOURLY /MO 3 /RL LIMITED /F
```

- Runs every 3 hours, independent of whether Paperclip is healthy.
- Verify: `schtasks /Query /TN "Paperclip Vault Backup"`
- Run on demand: `schtasks /Run /TN "Paperclip Vault Backup"`
- If Git isn't at `C:\Program Files\Git\bin\bash.exe`, adjust that path.

## Tunables (env vars, optional)

- `PAPERCLIP_VAULT_BACKUPS` — target dir (default `F:\Augi Vault\06 - Projects\Paperclip DB Backups`)
- `PAPERCLIP_BACKUP_RETAIN_DAYS` — retention window (default `30`)
- `PAPERCLIP_INSTANCE_BACKUPS` — source dir (default `~/.paperclip/instances/default/data/backups`)

## Change frequency

Re-run the `schtasks /Create ... /F` line with a different `/MO` (e.g. `/MO 1` for hourly).
