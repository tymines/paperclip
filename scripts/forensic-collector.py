#!/usr/bin/env python3
"""Forensic Collection Script — AUG-256.
Collects forensic evidence: server logs, DB table counts, backup dir listing,
cron statuses, disk usage. Writes timestamped Markdown report to vault.

Usage: python scripts/forensic-collector.py
  --output PATH   Override output path (default: vault)
  --json          Output as JSON instead of Markdown
"""

import subprocess, os, sys, json, datetime
from pathlib import Path

def run(cmd, timeout=15):
    """Run a command, return stripped stdout or error string."""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() or r.stderr.strip()
    except Exception as e:
        return f"ERROR: {e}"

def section(title, content):
    return f"## {title}\n\n```\n{content}\n```\n\n"

def main():
    now = datetime.datetime.now()
    ts = now.strftime("%Y-%m-%dT%H:%M:%S")
    date_str = now.strftime("%Y-%m-%d")

    report = f"# Forensic Collection — {ts}\n\n"

    # 1. Server health (use urllib — shell curl PATH unreliable from subprocess)
    try:
        import urllib.request
        with urllib.request.urlopen("http://localhost:3100/api/health", timeout=5) as resp:
            health = resp.read().decode()
        report += section("Server Health", health)
    except Exception as e:
        report += section("Server Health", f"SERVER_DOWN: {e}")

    # 2. Port occupancy
    report += section("Port 3100", run("netstat -ano | grep ':3100' | grep LISTEN || echo 'NOT_LISTENING'"))

    # 3. DB table counts
    db_counts = ""
    try:
        import psycopg2
        c = psycopg2.connect(host='127.0.0.1', port=54329, user='paperclip', password='paperclip', dbname='paperclip')
        cur = c.cursor()
        cur.execute("SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
        for schema, table in cur.fetchall():
            cur.execute(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
            count = cur.fetchone()[0]
            db_counts += f"{table:40s} {count:>6d} rows\n"
        c.close()
    except Exception as e:
        db_counts = f"ERROR: {e}"
    report += section("DB Table Counts", db_counts)

    # 4. Backup directory
    backups = run("ls -lth ~/.paperclip/instances/default/data/backups/paperclip-*.sql.gz 2>/dev/null | head -10 || echo 'NO_BACKUPS'")
    report += section("Latest Backups", backups)

    # 5. Disk usage
    disk = run("df -h /c /f 2>/dev/null || wmic logicaldisk get size,freespace,caption")
    report += section("Disk Usage", disk)

    # 6. Cron statuses
    cron = run("cd ~ && python3 -c \"import json; from hermes_tools import terminal; r=terminal('hermes cron list --json 2>/dev/null || echo []'); print(r['output'])\" 2>/dev/null || echo 'CRON_CHECK_FAILED'")
    report += section("Cron Status (summary)", cron[:2000])

    # 7. Git status (Paperclip repo)
    git_status = run("cd ~/paperclip && git status --short 2>/dev/null | head -20 || echo 'NO_GIT'")
    git_log = run("cd ~/paperclip && git log --oneline -3")
    report += section("Git Status (Paperclip)", f"{git_log}\n\n{git_status}")

    # 8. Last server log tail
    server_log = run("tail -20 ~/paperclip/paperclip-server.log 2>/dev/null || echo 'NO_LOG'")
    report += section("Server Log (last 20 lines)", server_log)

    # Write output
    output_arg = None
    output_json = False
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--output' and i+1 < len(args):
            output_arg = args[i+1]
            i += 1
        elif args[i] == '--json':
            output_json = True
        i += 1

    if output_arg:
        out_path = Path(output_arg)
    else:
        out_dir = Path("/f/Augi Vault/06 - Projects/Forensic Reports")
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"forensic-{date_str}.md"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report)
    print(f"Report written to: {out_path} ({len(report)} bytes)")

if __name__ == "__main__":
    main()
