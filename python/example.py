#!/usr/bin/env python3
"""Build the B2B sales pipeline diagram with the Python SDK.

Run from the repository root:  python python/example.py [output-dir]
Writes sales_pipeline.json and sales_pipeline.html to output-dir (default: the OS temp dir).
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from yantra import Diagram, blocks  # noqa: E402


def build() -> Diagram:
    d = Diagram(
        "Enterprise Customer Acquisition",
        "A B2B sales pipeline from inbound campaign to signed contract.",
    )
    d.summary(
        "Four stages turn an inbound lead into a signed contract in about 60 days.",
        points=["Marketing hands MQLs to SDRs within 5 minutes",
                "Solution engineers run the executive demo",
                "Legal and security review gate the close"],
        facts={"Cycle time": "~60 days", "Win rate": "24%"},
    )
    d.role("stage", "Sales stage", "blue").role("person", "Stakeholder", "amber").role("milestone", "Milestone", "green")
    d.add_mode("direct", "Direct sales", badge="DIRECT", default=True)
    d.add_mode("partner", "Partner-led", badge="PARTNER", description="A reseller runs discovery and the demo.")

    campaign = d.add_node("campaign", "Inbound Marketing", "stage", subtitle="Demand generation",
                          tech="HubSpot, Google Ads", icon="activity",
                          metadata={"Channels": "Search, LinkedIn, Webinars", "Target CPL": "£95"})
    sdr = d.add_node("sdr", "Sales Development", "person", subtitle="Lead qualification",
                     tech="Outreach, Salesforce", icon="users", metadata={"Team": "12 SDRs", "SLA": "< 5 min"})
    demo = d.add_node("demo", "Executive Demo", "stage", subtitle="Solution engineering", tech="Gong, Zoom")
    won = d.add_node("won", "Closed Won", "milestone", subtitle="Revenue recognised", tech="DocuSign, Stripe",
                     icon="flag", metadata={"ACV": "£95,000"})
    demo.mode_override("partner", subtitle="Run by the reseller", tech="Partner CRM")

    campaign.connect(sdr, "MQL hand-off").connect(demo, "Discovery call").connect(won, "MSA signed")
    d.group("pipeline", "Sales-owned", [sdr, demo], color="blue")

    d.add_step("The pipeline", "Four stages from first touch to signed contract.")
    d.add_step("Lead generation", "Prospects download the whitepaper and become MQLs.",
               nodes=["campaign", "sdr"], edges=["campaign-sdr"],
               payload={"status": "MQL", "latency": "< 5 min", "source": "Whitepaper"})
    d.add_step("Qualification", "An SDR qualifies budget, authority, need and timing.",
               nodes=["sdr", "demo"], edges=["sdr-demo"])
    d.add_step("Close", "Security review clears and the MSA is signed.",
               nodes=["demo", "won"], edges=["demo-won"])

    fast = d.scenario("fast-track", "Fast track", "Existing customers skip qualification.")
    fast.step("Expansion", "An account manager books the demo directly.", nodes=[demo])
    fast.step("Signed", "Order form countersigned.", nodes=[demo, won], edges=["demo-won"])

    d.panel("risks", "Risks", [
        blocks.points([("Slow hand-off", "MQLs older than an hour convert at half the rate.", "warn")],
                      nodes=["campaign", "sdr"]),
        blocks.callout("Security questionnaires add 2-3 weeks to enterprise deals.", label="Close risk",
                       tone="warn", nodes=["won"]),
    ])
    return d


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.gettempdir())
    out_dir.mkdir(parents=True, exist_ok=True)
    d = build()

    report = d.validate()
    for issue in report["errors"] + report["warnings"]:
        print(f"{issue['level']}: {issue['code']} {issue['message']}")

    d.save_json(os.path.join(out_dir, "sales_pipeline.json"))
    out = d.build_html(os.path.join(out_dir, "sales_pipeline.html"))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
