# Yantra teaser: script and storyboard

**Positioning:** Yantra is an explanation engine. The script runs pain, then turn, then
features, then use cases, then the ending. One offline HTML file is a supporting point, not
the headline.

**Format:** landscape 1920×1080 and vertical 1080×1920, 30fps, about 42s (the length
follows the voice-over). 120 BPM: Am–F under the pain points, C–G–Am–F from "Meet Yantra",
resolving on C. Every cut falls on the beat just before its voice-over line. `make.mjs`
measures the take and places the cuts; `beats.mjs` holds the event times that the picture
and the sound share.

## Voice-over (`voiceover.wav`, Speaker 1: Fola, Google AI Studio)

The script spells Yantra "Yun-truh" so the voice says YUN-truh. The 21 pauses in the take
split it into the phrases listed in `PHRASES_PER_LINE`.

| # | Line | Words (phrases split by pauses) | On screen |
|---|---|---|---|
| 1 | Pain | Diagrams take hours… / and go stale by Friday. | **Diagrams take hours to draw.** …and they're out of date by Friday. A diagram drawn by hand on a canvas, with a clock running. |
| 2 | Pain | AI drawings? / Overlapping boxes. Arrows to nowhere. | **AI diagrams? Boxes overlap. Arrows point nowhere.** The canvas turns into an "AI" mess, with red marks on the overlap and the dangling arrow. |
| 3 | Turn | Meet Yun-truh. | The Yantra logo. *Make your AI show its work.* |
| 4 | Feature | Describe it, or ask your agent. / Yun-truh draws it. | **Describe it. Yantra draws it.** *No boxes to place. Ask your coding agent or any AI chat.* The agent writes `checkout.json`; the real top-to-bottom export assembles. |
| 5 | Feature | Every diagram is checked… / before anyone sees it. | **Checked before anyone sees it.** *Broken links, overlaps and crossed labels, caught automatically.* Real `yantra validate` error, the fix, ✓ valid. |
| 6 | Feature | Then step through it, / like a story. | **Step through it like a story.** *Each step lights up what matters.* The real viewer, with Next clicked on beats. |
| 7 | Feature | Diagrams. Answer pages. / Books. | **Diagrams. Answer pages. Books.** One gallery tile per word. |
| 8 | Use cases | Onboard a team. / Review an incident. / Teach a lesson. | One real example per phrase: platform overview, incident review, photosynthesis. |
| 9 | Share | One file. / Even offline. | **One file. Opens anywhere, even offline.** The file card with a light/dark wipe; HTML, SVG, PNG and Markdown chips. |
| 10 | Ending | Yun-truh… / Don't draw it. / Explain it. | Yantra, then **Don't draw it. Explain it.**, then `npx @niyankhadka/yantra init`, the agents and yantra.nbk.com.np. |

The hand-drawn canvas, the "AI" mess and the agent's status lines are illustrative.
Everything else is real Yantra output, regenerated on every render.

## Sound

Music and effects share one grid and key: pluck drops on the hand-drawn boxes, muted notes
on the red marks, a bell chord on "Meet Yantra", typing ticks, plucks on the card pops,
clicks and tiles, an F chord on ✓ valid, and a C chord at the end. The music ducks about
9 dB under the voice, and the mix is normalised to −14 LUFS.
