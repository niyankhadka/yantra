# Teaser video pipeline

Renders the Yantra teaser from real Yantra output, a voice-over and generated music.

```bash
node scripts/video/make.mjs                          # both formats -> site/assets/video/
node scripts/video/make.mjs --format landscape       # or vertical
node scripts/video/make.mjs --stills 9.8,16.6        # review frames only
```

| File | Role |
|---|---|
| `plan.md` | The script, storyboard and sound plan. |
| `voiceover.wav` | The voice-over take (Google AI Studio, Speaker 1: Fola). The cuts follow it. |
| `checkout.json` | The README example the agent "writes". |
| `make.mjs` | Levels the voice, measures its phrases, captures the viewer and pages, renders, mixes and encodes. |
| `beats.mjs` | Event times shared by the picture and the sound. |
| `scene.mjs` | The page whose `render(t)` draws each frame, in both layouts. |
| `synth.mjs` | Music and effects on one beat grid, ducked under the voice. |
| `cdp.mjs` | Headless Chrome over the DevTools Protocol (no npm dependency). |

The outputs, `yantra-teaser-v<VERSION>.mp4` / `.jpg` / `.vtt` (captions) and `yantra-teaser-vertical-v<VERSION>.mp4` / `.jpg`,
go to `site/assets/video/`, which the website serves at `/video/`.

## Versions

Videos have their own version (`VERSION` in `make.mjs`), separate from the npm package. Bump it
when the video changes (a new take, a new cut). The website shows the newest version of each
video automatically and serves its poster at a stable address (`/video/yantra-teaser.jpg`), which
the README uses. Keep only the newest version in `site/assets/video/` (each teaser is about
23 MB); attach older versions to the GitHub release they belong to. Frames, captures and
stems go to the system temp folder (`YANTRA_VIDEO_WORK` to override).

It needs Chrome or Edge (`YANTRA_BROWSER`) and ffmpeg (`FFMPEG=path`, or on `PATH`).

If you record a new take, keep the same pauses. `make.mjs` stops with a message if it
doesn't find the expected number of phrases (`PHRASES_PER_LINE`).
