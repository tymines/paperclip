# Sizing — fake agent (busybox echo loop)

Last measured: 2026-05-09T10:59:47.993Z

## Workload

```sh
sleep 2; for round in $(seq 1 5); do   echo "round $round start";   for i in $(seq 1 200); do echo "round $round line $i"; sleep 0.05; done;   c=0; n=2; while [ $n -lt 5000 ]; do d=2; p=1; while [ $((d*d)) -le $n ]; do if [ $((n % d)) -eq 0 ]; then p=0; break; fi; d=$((d+1)); done; c=$((c+p)); n=$((n+1)); done;   echo "round $round primes=$c";   sleep 1; done; echo done; exit 0
```

## Peaks observed via metrics-server

| Metric | Peak |
|---|---|
| CPU | 16 m |
| Memory | 0 Mi |
| Samples observed | 8 |

## Sample timeline

| t (s since Job creation) | CPU | Memory |
|---|---|---|
| 30.2s | 16m | 0 Mi |
| 35.1s | 16m | 0 Mi |
| 40.1s | 16m | 0 Mi |
| 45.1s | 16m | 0 Mi |
| 50.1s | 16m | 0 Mi |
| 55.1s | 16m | 0 Mi |
| 60.1s | 14m | 0 Mi |
| 65.1s | 14m | 0 Mi |

## Disposition

This is a **sanity-check workload**, NOT a representative sample of real
`claude_local` agents. The busybox echo loop's resident set is on the order
of 1-3 MiB and CPU is near zero — it exercises the *measurement plumbing*
end-to-end, not the resource curve of any real agent runtime.

Real measurement against the live `claude-code` CLI is deferred to M3, when
the `agent-runtime-claude` image will be exercised against valid Anthropic
protocol. M1's defaults (256Mi requests / 1Gi limit, 200m / 2 CPU) are
retained until then.

Risk #4 in the M2 design spec is **partially resolved** by this report:
infrastructure ready, representative numbers pending real adapter.
