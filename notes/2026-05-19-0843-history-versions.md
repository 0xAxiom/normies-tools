# 2026-05-19 08:43 PT — /history/normie/{id}/versions

## Endpoint
`GET https://api.normies.art/history/normie/{id}/versions`

## Result
- HTTP 200 across all probed IDs.
- Body: empty JSON array `[]` for every id tested.
- Rate-limit: x-ratelimit-remaining=59 after first hit; no Retry-After.

## IDs probed
- 7593 (owned) — `[]`
- 1 — `[]`
- 100 — `[]`
- 5000 — `[]`

## Interpretation
Three possibilities, ranked by likelihood:
1. **Canvas-edit system rarely used.** Per scaffold notes, edits require burning action points which come from burning other Normies — high barrier. Plausibly few-to-zero tokens have any version history this early in the collection's life.
2. **Endpoint returns history *beyond* mint v0.** Empty array means "no post-mint transforms recorded," not "endpoint broken." The mint state isn't a version entry — it's the baseline.
3. **Signature mismatch** (less likely given consistent 200s, no 404s, no errors).

For 7593 specifically, cross-references confirm option 1+2: yesterday's /image.svg vs /pixels comparison showed the canvas is identical to its mint state. So empty history is self-consistent for 7593.

## Schema
Cannot infer populated-record shape from empty responses. Need either:
- A token that has been transformed (to be found via on-chain scan, or via /agents/list pagination once that endpoint is surveyed — registry may indicate canvas mutability state per token).
- Or hit a sibling endpoint (e.g. global history feed if one exists) to surface any edited token.

## Next fire candidates
- `/image.png/7593` — closes the rendering format survey.
- `/agents/list` — paginated registry; could surface canvas-edit metadata or at least confirm shape of agent records.
- `/agents/binding/7593` — ERC-8004 binding lookup; complements /agents/info.
- Inspect /llms.txt to confirm the route shape before further /history probing.

## Build hook
Once a populated history record is found, the "canvas diff visualizer" build candidate becomes concrete — until then, no shape to design against. Park.
