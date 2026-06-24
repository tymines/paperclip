"""
Gemini direct-API metering helper.

Drop-in logging for the Gemini call sites that bypass the litellm proxy
(the visual Reviewer / QC agents and the design image-gen agents). Given a raw
generateContent response dict, it reads the REAL usageMetadata token counts,
computes cost from the verified price table, and logs one MLflow run to the
shared fleet-llm-calls experiment.

Gemini billing note: for 2.5-flash the response splits output into
`candidatesTokenCount` (visible answer) + `thoughtsTokenCount` (reasoning);
BOTH are billed as output, so output_tokens = candidates + thoughts. For the
image models, `candidatesTokenCount` is the image-token count and is priced at
the image output rate in PRICING.

Usage at a call site (after you get the parsed JSON `resp` and know `model`):

    import sys; sys.path.insert(0, os.path.expanduser("~/.openclaw"))
    from mlflow_usage_logger import log_usage_async
    from gemini_meter import meter_gemini

    meter_gemini(model, resp, latency_ms=ms, source="gemini-reviewer")
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.expanduser("~/.openclaw"))

try:
    from mlflow_usage_logger import log_usage, log_usage_async, cost_from_tokens
except Exception:  # pragma: no cover
    log_usage = log_usage_async = cost_from_tokens = None


def extract_usage(resp):
    """Return (prompt_tokens, output_tokens, total_tokens) from a Gemini
    generateContent response dict. output = candidates + thoughts (both billed)."""
    um = (resp or {}).get("usageMetadata", {}) or {}
    pt = um.get("promptTokenCount")
    cand = um.get("candidatesTokenCount") or 0
    thoughts = um.get("thoughtsTokenCount") or 0
    out = (cand + thoughts) if (cand or thoughts) else None
    tt = um.get("totalTokenCount")
    return pt, out, tt


def meter_gemini(model, resp, latency_ms=None, source="gemini-direct",
                 status="ok", call_id="", async_=True, extra_tags=None):
    """Log one MLflow run for a Gemini call. Never raises."""
    if log_usage is None:
        return None
    try:
        pt, out, tt = extract_usage(resp)
        # provider_model is the actual model the API answered with, if present.
        actual = (resp or {}).get("modelVersion") or model
        fn = log_usage_async if async_ else log_usage
        return fn(
            provider_model=actual,
            alias=actual,
            provider="google",
            source=source,
            prompt_tokens=pt,
            completion_tokens=out,
            total_tokens=tt,
            latency_ms=latency_ms,
            status=status,
            call_id=call_id,
            extra_tags=extra_tags,
        )
    except Exception:
        return None
