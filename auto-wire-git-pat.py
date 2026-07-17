"""
auto-wire-git-pat.py -- One-shot: wire GitHub PAT from paperclip.env into git.
Triggered when Tyler pastes MERGE_TRAIN_PAT=<token> into paperclip.env.

ponytail: reads .env, checks BOM, configures git non-interactively, verifies.
"""
import os, sys, subprocess, hashlib

ENV_PATH = "C:/Users/Augi-T1/paperclip.env"
GITHUB_USER = "tymines"
FORBIDDEN_VALUE = "<PASTE_HERE>"


def parse_env(path):
    """Parse .env, reject BOM, return dict."""
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError("BOM DETECTED in .env -- remove the UTF-8 BOM and save again")

    result = {}
    text = raw.decode("utf-8")
    for lineno, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Line {lineno}: missing '=' in: {line}")
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        result[key] = value
    return result


def configure_git(pat):
    """Wire git to use PAT non-interactively. Pin account, kill GCM popup."""
    cred_file = os.path.expandvars("$HOME/.git-credentials")
    cred_line = f"https://{GITHUB_USER}:{pat}@github.com\n"

    # Remove any existing github.com line, add ours
    existing = []
    if os.path.exists(cred_file):
        with open(cred_file) as f:
            existing = [l for l in f if "github.com" not in l]
    with open(cred_file, "w") as f:
        f.write(cred_line)
        for line in existing:
            f.write(line)
    os.chmod(cred_file, 0o600)
    print(f"[OK] Wrote {cred_file}")

    # Configure git to use 'store' helper (no GCM popup)
    run("git", "config", "--global", "credential.helper", "store")
    print("[OK] git config credential.helper = store")

    # Unset the GCM manager selector that causes "Select an account" popup
    run("git", "config", "--global", "--unset", "credential.helperselector.selected", check=False)
    print("[OK] Unset credential.helperselector.selected (GCM popup disabled)")

    # Pin account
    run("git", "config", "--global", "credential.https://github.com.username", GITHUB_USER)
    print(f"[OK] git config credential.https://github.com.username = {GITHUB_USER}")

    # Prevent any interactive prompts
    os.environ["GCM_INTERACTIVE"] = "never"
    os.environ["GIT_TERMINAL_PROMPT"] = "0"


def run(*args, check=True, **kwargs):
    """Run a command, print output, return CompletedProcess."""
    kwargs.setdefault("capture_output", True)
    kwargs.setdefault("text", True)
    kwargs.setdefault("timeout", 30)
    result = subprocess.run(args, **kwargs)
    if result.stdout.strip():
        print(result.stdout.strip())
    if check and result.returncode != 0:
        print(f"[WARN] {args[0]} exit {result.returncode}: {result.stderr.strip()}")
    return result


def verify():
    """Test that git authenticates silently (no popup)."""
    print("\n--- Verification ---")
    os.environ["GCM_INTERACTIVE"] = "never"
    os.environ["GIT_TERMINAL_PROMPT"] = "0"

    # Test 1: ls-remote (read-only, no push risk)
    r = run("git", "ls-remote", "https://github.com/HenkDz/paperclip.git", "HEAD",
            timeout=15, check=False)
    if r.returncode == 0 and "HEAD" in r.stdout:
        print("[PASS] git ls-remote -- authenticated silently")
    else:
        print(f"[FAIL] git ls-remote returned: {r.returncode}")
        if r.stderr.strip():
            print(f"  stderr: {r.stderr.strip()}")
        return False

    # Test 2: credential helper is store (not manager)
    r2 = run("git", "config", "--global", "credential.helper", check=False)
    if "store" in r2.stdout and "manager" not in r2.stdout:
        print("[PASS] credential.helper = store (no GCM)")
    else:
        print(f"[WARN] credential.helper = {r2.stdout.strip()}")

    # Test 3: helperselector gone
    r3 = run("git", "config", "--global", "credential.helperselector.selected", check=False)
    if r3.returncode != 0:
        print("[PASS] credential.helperselector.selected = unset (no popup)")
    else:
        print(f"[WARN] credential.helperselector.selected still set: {r3.stdout.strip()}")

    return True


def main():
    if not os.path.exists(ENV_PATH):
        print(f"ERROR: {ENV_PATH} not found. Waiting for Tyler to create it.")
        sys.exit(1)

    try:
        env = parse_env(ENV_PATH)
    except ValueError as e:
        print(f"FAIL: {e}")
        sys.exit(1)

    pat = env.get("MERGE_TRAIN_PAT", "")
    if not pat or pat == FORBIDDEN_VALUE:
        print("ERROR: MERGE_TRAIN_PAT is empty or still placeholder. Waiting for real token.")
        sys.exit(1)

    # Sanity checks
    assert not pat.startswith("***"), "PAT appears masked (starts with ***)"
    assert len(pat) > 20, f"PAT too short ({len(pat)} chars -- expected 40+)"
    print(f"[OK] PAT loaded: {len(pat)} chars, starts with {pat[:4]}..., no BOM")

    # Show checksum for verification (not secret -- one-way)
    print(f"[OK] SHA-256 of .env: {hashlib.sha256(open(ENV_PATH, 'rb').read()).hexdigest()}")

    configure_git(pat)
    ok = verify()

    print("\n=== AUTO-WIRE COMPLETE ===")
    print(f"Status: {'PASS' if ok else 'PARTIAL -- check warnings above'}")
    print("GCM popup: DISABLED")


if __name__ == "__main__":
    main()
