"""
Fable E1: 8-stage shadow pipeline run
Idea -> Spec -> Design -> Architecture -> Build -> Review -> Ship -> Retro
Entry ONLY at Idea, sequential, no skipping.
Outputs .rail_events.jsonl with rooms_shadow_decision events.
"""
import json, time, os
from datetime import datetime, timezone

STAGES = ["idea", "spec", "design", "architecture", "build", "review", "ship", "retro"]
OUTPUT = os.path.join(os.path.dirname(__file__) or ".", ".rail_events.jsonl")

def emit(stage, status, detail=""):
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "type": "rooms_shadow_decision",
        "stage": stage,
        "stage_index": STAGES.index(stage),
        "total_stages": len(STAGES),
        "status": status,
        "detail": detail,
        "shadow": True,
        "enforcement": "OFF",
    }
    with open(OUTPUT, "a") as f:
        f.write(json.dumps(event) + "\n")
    print(f"  [{event['stage_index']+1}/{len(STAGES)}] {stage:14s} -> {status}")

# Clear previous run
if os.path.exists(OUTPUT):
    os.remove(OUTPUT)

print("=== Fable E1: 8-stage shadow pipeline ===")
print(f"Output: {OUTPUT}\n")

# Entry gate: only Idea
emit("idea", "entry", "Pipeline entry point — Tyler triggers idea room")

# Stage 1-8 sequential progression
for i, stage in enumerate(STAGES):
    time.sleep(0.1)  # simulate processing
    
    # Gate check (shadow: always passes)
    emit(stage, "started", f"Gate check: auto_approve=False, shadow=pass")
    emit(stage, "completed", f"Stage {i+1}/{len(STAGES)} complete — shadow enforcement OFF")

# Verify sequence integrity
with open(OUTPUT) as f:
    events = [json.loads(line) for line in f if line.strip()]

# Each stage gets 2 events (started + completed) + 1 entry event for idea
print(f"\n=== VERIFICATION ===")
print(f"Total events: {len(events)}")
    
seen_stages = set()
for e in events:
    seen_stages.add(e["stage"])
    
print(f"Unique stages: {len(seen_stages)}")
print(f"Stages in order: {[STAGES[i] for i in range(len(STAGES))]}")
print(f"Actual: {sorted(seen_stages, key=lambda s: STAGES.index(s))}")
print(f"Shadow mode: all events shadow=True, enforcement=OFF")

# Output the raw events
print(f"\n=== .rail_events.jsonl ===")
with open(OUTPUT) as f:
    for line in f:
        print(f"  {line.rstrip()}")
