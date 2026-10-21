---
description: Share Yantra output as one offline HTML file, SVG, PNG or Markdown; link to a step with the URL hash; embed a diagram with an iframe; print and brand it.
---

# Embedding and sharing

Everything Yantra makes ends up as a file you own. Pick the form that suits where it is
going.

| Where it goes | Use | Command |
|---|---|---|
| Email, a ticket, a shared drive, a USB stick | the interactive HTML file | `yantra build x.json` |
| A web page or docs site | the HTML file, linked or in an iframe | `yantra build x.json` |
| A slide, a PDF, a README, a chat message | an image | `yantra export x.json -f svg`, `yantra screenshot x.json` |
| A wiki, an issue, a pull request description | Markdown | `yantra export x.json -f md` |
| Paper | the HTML file, printed | print from the browser |

The [playground](https://yantra.nbk.com.np/playground/) downloads all of these too:
**Standalone HTML**, **SVG**, **PNG**, **Markdown** and the **JSON**.

## One HTML file

`yantra build` writes a single file with the viewer, its styles, the diagram and the
interface strings it needs inlined. It makes **no network requests**: no CDN, no fonts, no
analytics. That means:

- it opens offline, from an attachment or a local folder;
- it keeps working after the Yantra project changes, because nothing is fetched;
- it can be archived next to the decision or incident it explains.

Answer pages build the same way. A page with live diagrams (`"interactive": true`) shares
one copy of the viewer between them.

## Links that reopen a view

The viewer mirrors its state in the URL hash, so a copied link reopens the same view:

```text
checkout.html#step=3
checkout.html#step=2&view=sequence&theme=dark
platform.html#level=payments&step=2
city.html#depth=2&focus=north
```

| Key | Meaning |
|---|---|
| `step` | walkthrough step, from 1 |
| `scenario` | scenario number, from 1, when there are several |
| `mode` | a mode id (for example `dev` against `prod`) |
| `view` | `flow` or `sequence` |
| `level` | a drill-down detail diagram |
| `collapsed`, `depth`, `focus` | folded groups or subtrees, fold to a depth, zoom to a group |
| `theme` | `light` or `dark` |

## Embed in a web page

Host the built file next to your page and frame it:

```html
<iframe src="/diagrams/checkout.html#step=2&theme=light"
        title="Checkout walkthrough" width="100%" height="560"
        style="border: 1px solid #dcdad3; border-radius: 12px"></iframe>
```

The [landing page of this site](https://yantra.nbk.com.np/) embeds the cloud architecture
example exactly like this. Keyboard shortcuts work once the frame has focus. In docs
generators that cannot hold an iframe, link the HTML file instead and show an SVG export
inline.

## Static images

```bash
yantra export checkout.json -f svg                     # checkout.svg, light theme
yantra export checkout.json -f svg --theme dark --step 2
yantra export checkout.json -f svg --view sequence
yantra screenshot checkout.json --width 1600           # checkout-light.png via Chrome or Edge
yantra screenshot answer.json --width 390              # a page at phone width
```

SVG exports are plain SVG (no `foreignObject`), so they convert cleanly to PNG or PDF and
render on GitHub. `--level id` exports a detail diagram, `--mode id` a mode. Answer pages
export to HTML or Markdown, not SVG.

## Markdown

`yantra export x.json -f md` writes a readable Markdown version: the title and summary,
tables of the cards and connections, and the walkthrough (for a page: the answer and every
block). Paste it where only text is welcome. `--all-levels` appends every detail
diagram.

## Print

Printing switches to the light theme and hides the controls. Answer pages are laid out for
A4, with FAQ answers opened and charts kept in colour.

## Branding and the badge

- Built files show a small "Made with Yantra" badge that links to the project.
  `meta.watermark: false` hides it; a string replaces its text. Keeping it is a simple way
  to support the project.
- From a clone, put your own logo in `src/assets/logo-light.svg` and `logo-dark.svg`: it
  replaces the default mark in the toolbar, the badge and exports. The Yantra name and logo
  themselves follow the
  [trademark policy](https://github.com/niyankhadka/yantra/blob/main/TRADEMARKS.md).

## Languages

Set `meta.lang` (for example `"es"`, `"ja"`, `"ar"`) and the viewer controls, page labels,
the badge and exports switch language, with that locale's number format. Arabic, Hebrew,
Persian and Urdu lay the interface out right to left. See
[Languages and right to left](../../docs/authoring.md#languages-and-right-to-left).
