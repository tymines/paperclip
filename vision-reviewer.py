#!/usr/bin/env python3
"""Vision Reviewer Agent — compares a render screenshot to a concept image.
Usage: python3 vision-reviewer.py <render.png> <concept.png>
Requires OPENAI_API_KEY in env.
"""
import os, sys, base64, json, requests

key = os.environ.get("OPENAI_API_KEY", "")
if not key:
    print("ERROR: OPENAI_API_KEY not set", file=sys.stderr)
    sys.exit(1)

if len(sys.argv) < 3:
    print("Usage: vision-reviewer.py <render.png> <concept.png>", file=sys.stderr)
    sys.exit(1)

render_path = sys.argv[1]
concept_path = sys.argv[2]

def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

prompt = """You are a strict Visual Fidelity Reviewer comparing a UI render against a concept image.

The concept shows:
- A radial 6-lobe brain layout around a central energy core
- The core fires radiating filaments into each lobe
- Dense per-lobe particle glow
- Dark near-black background
- Toned-down glow (not blown out)

Compare the RENDER to the CONCEPT and return STRICT JSON only (no markdown):
{
  "fidelity_score": 0-100,
  "gaps": {
    "layout": "...",
    "density": "...",
    "core": "...",
    "filaments": "...",
    "color": "...",
    "glow": "..."
  },
  "summary": "..."
}

Rules:
- If the render does NOT show a radial 6-lobe layout, score MUST be below 50.
- If there is no distinct central energy core, subtract 20 points.
- If filaments are missing or just random graph edges, subtract 15 points.
- If glow is blown out / too bright, subtract 10 points.
- Be brutally honest. Do not assume features exist; look carefully."""

url = "https://api.openai.com/v1/chat/completions"
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
payload = {
    "model": "gpt-4o",
    "messages": [
        {"role": "system", "content": "You are a strict visual fidelity reviewer. Respond only in valid JSON."},
        {"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(concept_path)}", "detail": "high"}},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(render_path)}", "detail": "high"}}
        ]}
    ],
    "max_tokens": 1200,
    "temperature": 0.1
}

resp = requests.post(url, headers=headers, json=payload, timeout=120)
resp.raise_for_status()
text = resp.json()["choices"][0]["message"]["content"].strip()
if text.startswith("```"):
    text = text.split("\n", 1)[1]
if text.endswith("```"):
    text = text.rsplit("\n", 1)[0]
text = text.strip()
result = json.loads(text)
print(json.dumps(result, indent=2))
