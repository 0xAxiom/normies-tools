# Cursor Pagination Discovery

**Date:** 2026-05-30
**Status:** Solved

## Finding

The `/agents/list` API supports cursor-based pagination via the `cursor` query param. The `offset` param is ignored (returns same page regardless of value), but `cursor=<agentId>` returns results with agentId strictly less than the cursor value, in descending order.

## Parameters

| Param | Works | Behavior |
|-------|-------|----------|
| `offset` | No | Ignored, always returns first page |
| `page` | No | Ignored |
| `before` | No | Ignored |
| `after` | No | Ignored |
| `order` | No | Ignored, always descending by agentId |
| `cursor` | Yes | Returns items with agentId < cursor, descending |
| `limit` | Yes | Controls page size (max tested: 100) |

## Usage

```
# First page (most recent agents)
GET /agents/list?limit=100

# Next page: use last item's agentId as cursor
GET /agents/list?limit=100&cursor=33929

# Continue until hasMore=false or items=[]
```

## Census Results

- **1,116 total awakened agents** as of 2026-05-30 12:17 PT
- AgentId range: 32340 to 34029
- 12 pages to walk the full list at limit=100
- Rate: ~0.5s delay between pages, full walk takes ~8s

## Impact

- `discover.py` updated with `--full` flag for census mode
- Default mode still fetches only the leading edge (first page) for incremental cron
- Full census populates `data/agents-known.json` with all 1,116 known agents
- The "full awakened census" queue item is now solvable without walking 10k tokenIds
