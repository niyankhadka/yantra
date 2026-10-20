#!/usr/bin/env python3
"""Build a one-page answer with an embedded diagram using the Python SDK.

Run from the repository root:  python python/example_page.py [output-dir]
Writes cache_answer.json and cache_answer.html to output-dir (default: the OS temp dir).
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from yantra import Diagram, Page  # noqa: E402


def cache_diagram() -> Diagram:
    d = Diagram("Read path with a cache", "How a product page is served.")
    d.role("client", "Client", "amber").role("service", "Service", "blue").role("data", "Data", "violet")
    web = d.add_node("web", "Storefront", "client", subtitle="Product page", icon="monitor")
    api = d.add_node("api", "Catalogue API", "service", subtitle="Reads products", tech="Node.js")
    cache = d.add_node("cache", "Redis", "data", subtitle="Hot products", icon="zap")
    db = d.add_node("db", "Catalogue DB", "data", subtitle="Source of truth", tech="PostgreSQL", icon="database")
    web.connect(api, "GET /product")
    api.connect(cache, "GET key")
    api.connect(db, "SELECT on miss")
    d.add_step("Overview", "A cache sits beside the database.")
    d.add_step("Cache hit", "Most reads are served from Redis.", nodes=[web, api, cache],
               edges=["web-api", "api-cache"])
    d.add_step("Cache miss", "On a miss the API reads the database.", nodes=[api, db], edges=["api-db"])
    return d


def build() -> Page:
    p = Page("Should the catalogue API cache product reads in Redis?", title="Catalogue caching",
             kicker="Decision", author="Platform team", date="20/10/2026")
    p.answer("Yes: cache product reads in Redis with a 5-minute TTL; it cuts p95 latency by about 80% "
             "and the data tolerates brief staleness.",
             text="Product data changes a few times a day but is read thousands of times a second.",
             points=["95% of reads hit 2% of products", "Prices are re-checked at checkout",
                     "Redis is already in the platform"])
    p.diagram(cache_diagram(), step=2, title="Where the cache sits",
              caption="Reads try Redis first and fall back to the database.")
    p.steps([("Read through", "Look up the key; on a miss load from the DB and set it."),
             ("Expire", "A 5-minute TTL bounds staleness."),
             ("Invalidate", "Product updates delete the key.")], title="How it works", span="half")
    p.callout("Never serve the **price** from cache at checkout; re-read it from the database.",
              label="Caveat", tone="warn", span="half")
    p.metrics([("p95 latency", "38 ms", "from 190 ms"), ("Hit rate", "94%", "in load test")], title="Expected effect")
    p.compare([
        {"name": "No cache", "pros": ["Nothing new to run"], "cons": ["DB at 70% CPU at peak"]},
        {"name": "Redis read-through", "pros": ["Big latency win", "Already operated"],
         "cons": ["Up to 5 minutes stale"], "verdict": "Chosen.", "recommended": True},
    ], title="Options")
    p.chart({"DB read": 190, "Redis hit": 4}, unit=" ms", title="Read latency (p95)")
    p.code("SET product:42 '{...}' EX 300", language="redis", title="Cache entry")
    p.sources([("Redis: caching patterns", "https://redis.io/docs/latest/develop/use/patterns/")], title="Sources")
    return p


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.gettempdir())
    out_dir.mkdir(parents=True, exist_ok=True)
    p = build()

    report = p.validate()
    for issue in report["errors"] + report["warnings"]:
        print(f"{issue['level']}: {issue['code']} {issue['message']}")

    print(f"Wrote {p.save_json(os.path.join(out_dir, 'cache_answer.json'))}")
    print(f"Wrote {p.build_html(os.path.join(out_dir, 'cache_answer.html'))}")


if __name__ == "__main__":
    main()
