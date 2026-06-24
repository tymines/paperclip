# Cost metering for proxy-bypassing providers (Gemini + Qwen)

The Costs tab reads real per-call LLM spend from the local MLflow tracking
server (experiment `fleet-llm-calls`) via `GET /mlflow/costs`, grouped by the
`provider_model` tag. The AugiVector **litellm proxy** (:3000) already logs the
5 models that flow through it (`mlflow_litellm_logger.py`). Two providers
**bypass the proxy** and were therefore missing from MLflow and the Costs tab:

| Provider | Where it's called | Models in real use | Verified list price (2026-06-24) |
|---|---|---|---|
| **Gemini** (direct REST `generativelanguage.googleapis.com`, key = `openclaw.json:env.GEMINI_API_KEY`) | Visual Reviewer / QC agents — `~/.openclaw/repos/missioncontrol/qa_screens/agent_review/freeform_review.py` and `agent_review_2/freeform_review_multi.py`; design image-gen — `~/.openclaw/repos/bailysapp/scripts/gen_food_photos.py`, `gen_explore_photos.py` | `gemini-2.5-flash` (reviewer primary); `gemini-2.0-flash`, `gemini-flash-latest` (fallbacks); `gemini-3-pro-image` / `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` (design image gen) | 2.5-flash **$0.30 / $2.50** per-M in/out; 2.0-flash **$0.10 / $0.40** (deprecated, shut down 2026-06-01); 3-pro-image output **$120/M** image-tok (~$0.134/1-2K img); 3.1-flash-image output **$60/M** image-tok (~$0.067/1K img) |
| **Qwen** (OpenRouter `openrouter.ai/api/v1`, key = `BailysApp/Secrets.swift:openRouterKey`) | **BailysApp personal-assistant agent** — `~/.openclaw/repos/bailysapp/BailysApp/Services/AIService.swift` (+ `BailyTools.swift`). NOT DashScope. | `qwen/qwen3-vl-8b-instruct` (default; `qwen3-vl-32b-instruct` optional) | 8B-instruct **$0.08 / $0.50** per-M in/out |

Sources: Google AI pricing `https://ai.google.dev/gemini-api/docs/pricing`;
OpenRouter `https://openrouter.ai/qwen/qwen3-vl-8b-instruct`. Gemini image-token
rates per Google pricing / LaoZhang & aifreeapi 2026 guides.

## How each is metered

All runs are written in the **exact** schema the litellm callback uses (tags:
`model_alias`, `provider_model`, `provider`, `source`, `status`; metrics:
`cost_usd`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens`,
`ok`) so they reconcile into the same MLflow total and group per-model.

- **`mlflow_usage_logger.py`** — shared stdlib logger + verified `PRICING` table +
  `cost_from_tokens()`. Deployed to `~/.openclaw/` so the live call sites import it.
- **`gemini_meter.py`** — reads real `usageMetadata` from a Gemini response
  (output = `candidatesTokenCount` + `thoughtsTokenCount`, both billed), computes
  cost, logs one run. Wired into the two reviewer scripts (synchronous, since
  they are short-lived CLIs; guarded so it can never break the review).
  **Forward-capture**: every new reviewer/QC call is now metered automatically.
- **`openrouter_qwen_importer.py`** — pulls the BailysApp key's real cumulative
  USD spend from OpenRouter `GET /api/v1/key` and upserts ONE idempotent MLflow
  run (tag `import_id=openrouter-qwen-cumulative`). Safe to schedule.

## Backfill honesty

- **Gemini**: no historical token counts were stored (the `out_*.json` review
  artifacts hold only the verdict text), so **past** Gemini calls cannot be
  reconstructed. Metering is **forward-capture**; the current Costs figure comes
  from real reviewer calls run after instrumentation.
- **Qwen**: the BailysApp key's **true cumulative cost** ($0.010930201 at import)
  is recovered from OpenRouter — a real, accurate attribution (the key is
  dedicated to the Qwen assistant). OpenRouter's standard (non-provisioning) key
  endpoint exposes cumulative cost but **not** per-call history or token totals,
  so the run carries the real cost with tokens unknown (0). True per-call /
  per-token Qwen capture going forward requires the iOS app to POST each
  response's `usage` block to a local collector — that is the documented forward
  path and is not retrofittable to calls already made from the phone.

## Headline repoint

`ui/src/pages/Costs.tsx` — the **Inference spend** headline (and the Budget
card) now read the authoritative MLflow total (`/mlflow/costs.totalCostUsd`)
instead of the `cost_events` bridge ESTIMATE, so the whole page agrees on one
source of truth. Falls back to the `cost_events` figure only if MLflow is
unreachable.
