#!/usr/bin/env python3
"""
Backfill cost_events table with correct costCents computed from the pricing table.
Run this after deploying the pricing module and heartbeat fix.

Usage: python3 backfill-costs.py
Or:    cd ~/paperclip && tsx scripts/backfill-costs.ts
"""
import json
import subprocess
import sys

DB_HOST = "localhost"
DB_PORT = 54329
DB_USER = "paperclip"
DB_NAME = "paperclip"
DB_PASS = "paperclip"

# Pricing table (same as model-pricing.ts)
PRICING = {
    # DeepSeek
    "deepseek-v4-flash": (0.14, 0.0028, 0.28),
    "deepseek-v4-pro": (0.435, 0.003625, 0.87),
    "deepseek-chat": (0.14, 0.0028, 0.28),
    "deepseek-reasoner": (0.14, 0.0028, 0.28),
    "deepseek/deepseek-v4-flash": (0.14, 0.0028, 0.28),
    "deepseek/deepseek-v4-pro": (0.435, 0.003625, 0.87),
    # Moonshot/Kimi
    "kimi-k2.6": (0.95, 0.16, 4.00),
    "kimi-k2.7-code": (0.95, 0.16, 4.00),
    "kimi-k2.7": (0.95, 0.16, 4.00),
    "moonshotai/kimi-k2.6": (0.95, 0.16, 4.00),
    "moonshotai/kimi-k2.7-code": (0.95, 0.16, 4.00),
    # Gemini
    "gemini-2.5-flash": (0.30, 0.15, 1.20),
    "gemini-2.5-pro": (0.30, 0.15, 1.20),
    "gemini-3-pro": (2.00, 1.00, 12.00),
    "gemini-3.1-pro": (2.00, 1.00, 12.00),
    "gemini-3.1-pro-preview": (2.00, 1.00, 12.00),
    "gemini-3.5-flash": (1.50, 0.15, 9.00),
    "google/gemini-3.1-pro": (2.00, 1.00, 12.00),
    # GLM
    "glm-5.2": (1.40, 0.26, 4.40),
    "glm-5.1": (1.40, 0.26, 4.40),
    "glm-5": (1.00, 0.20, 3.20),
    "z-ai/glm-5.2": (1.40, 0.26, 4.40),
    # MiniMax
    "minimax-m2.7": (0.30, 0.06, 1.20),
    "minimax-m3": (0.30, 0.06, 1.20),
    "minimax/minimax-m2.7": (0.30, 0.06, 1.20),
    # Qwen
    "qwen3-vl": (0.104, 0.052, 0.416),
    "qwen3-vl-32b": (0.104, 0.052, 0.416),
    "qwen/qwen3-vl-32b-instruct": (0.104, 0.052, 0.416),
    "qwen3.5-plus": (0.40, 0.20, 2.40),
    # Anthropic
    "claude-sonnet-4.6": (3.00, 0.30, 15.00),
    "claude-opus-4.8": (5.00, 0.50, 25.00),
    "claude-haiku-4.5": (1.00, 0.10, 5.00),
    "anthropic/claude-sonnet-4.6": (3.00, 0.30, 15.00),
    # OpenAI
    "gpt-5.5": (5.00, 0.50, 30.00),
    "gpt-5.4": (2.50, 0.25, 15.00),
    "openai/gpt-5.5": (5.00, 0.50, 30.00),
}

def compute_cents(model, input_tokens, cached_input_tokens, output_tokens):
    key = model.lower().strip()
    if key not in PRICING:
        return None  # Unknown model
    in_rate, cache_rate, out_rate = PRICING[key]
    cost = (input_tokens / 1_000_000) * in_rate
    cost += (cached_input_tokens / 1_000_000) * cache_rate
    cost += (output_tokens / 1_000_000) * out_rate
    return max(0, round(cost * 100))

def main():
    pg_cmd = [
        "/usr/bin/sqlite3",  # We use PG, so this won't work
    ]
    
    # Use psql via the node pg client instead
    node_script = """
    const {Client} = require('/Users/augi/paperclip/node_modules/.pnpm/pg@8.18.0/node_modules/pg');
    const client = new Client({host:'localhost',port:54329,user:'paperclip',database:'paperclip',password:'paperclip'});
    
    async function run() {
      await client.connect();
      
      // Get all cost events with tokens
      const {rows} = await client.query(`
        SELECT id, model, input_tokens, cached_input_tokens, output_tokens, cost_cents 
        FROM cost_events 
        WHERE input_tokens > 0 OR output_tokens > 0 OR cached_input_tokens > 0
        ORDER BY occurred_at DESC
      `);
      
      console.log(JSON.stringify(rows));
      await client.end();
    }
    run().catch(e => { console.error('ERR:'+e.message); process.exit(1); });
    """
    
    result = subprocess.run(
        ["bash", "-c", f"cd ~/paperclip && /Users/augi/.local/bin/node -e '{node_script}' 2>&1 | grep -v '^✅\|^🔗\|^👤\|^$'"],
        capture_output=True, text=True, timeout=30
    )
    
    lines = [l for l in result.stdout.strip().split('\n') if l and not l.startswith('ERR')]
    if not lines:
        print("No output or error:", result.stderr)
        return
    
    try:
        rows = json.loads(lines[-1])
    except json.JSONDecodeError:
        print(f"Failed to parse JSON. Last line: {lines[-1] if lines else 'empty'}")
        return
    
    print(f"Found {len(rows)} cost events with token usage")
    
    updates = []
    for row in rows:
        old_cents = int(row['cost_cents'])
        new_cents = compute_cents(row['model'], int(row['input_tokens']), int(row['cached_input_tokens']), int(row['output_tokens']))
        if new_cents is not None and new_cents != old_cents:
            updates.append((row['id'], old_cents, new_cents, row['model'], row['input_tokens'], row['cached_input_tokens'], row['output_tokens']))
    
    if not updates:
        print("No events need updating (all unknown models or already correct)")
        return
    
    print(f"\nEvents to update: {len(updates)}")
    for eid, old, new, model, i, c, o in updates:
        print(f"  {eid[:8]}... | {model:30s} | in={int(i):>8} cached={int(c):>8} out={int(o):>8} | ${old/100:.2f} → ${new/100:.2f}")
    
    # Perform updates
    update_script = f"""
    const {{Client}} = require('/Users/augi/paperclip/node_modules/.pnpm/pg@8.18.0/node_modules/pg');
    const client = new Client({{host:'localhost',port:54329,user:'paperclip',database:'paperclip',password:'paperclip'}});
    async function run() {{
      await client.connect();
      const updates = {json.dumps([(eid, int(new_cents)) for eid, _, new_cents, _, _, _, _ in updates])};
      for (const [id, cents] of updates) {{
        await client.query('UPDATE cost_events SET cost_cents = $1 WHERE id = $2', [cents, id]);
      }}
      console.log('Updated ' + updates.length + ' events');
      await client.end();
    }}
    run().catch(e => {{ console.error('ERR:'+e.message); process.exit(1); }});
    """
    
    print("\nApplying updates...")
    result = subprocess.run(
        ["bash", "-c", f"cd ~/paperclip && /Users/augi/.local/bin/node -e '{update_script}' 2>&1"],
        capture_output=True, text=True, timeout=30
    )
    print(result.stdout.strip())
    if result.stderr:
        print("STDERR:", result.stderr.strip())

if __name__ == "__main__":
    main()
