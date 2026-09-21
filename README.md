# Generative Thoughts v8 — more organic

## Start

Double-click `start.command`, or run:

```sh
npm start
```

The command starts the local app and opens <http://localhost:9999> automatically.
If the app is already running, using the command again opens the existing app instead
of failing with a port-in-use error.

Project boundaries and local-data rules are documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The planned image-to-ASCII interlude
is specified separately in
[`docs/NEXT_STAGE_IMAGE_INTERLUDE.md`](docs/NEXT_STAGE_IMAGE_INTERLUDE.md).

This revision keeps the minimal interface from v7, but changes four major things:

## 1. Background texture
Every note now has a subtle background texture system, generated from the note itself.

The background uses only subtle paper-like texture:
- fine dust
- sparse short fibers
- very soft mottling

There are no grids, scan lines, crosshatching, or other lined patterns.

## 2. Structured ASCII cover engine
Each cover selects one explicit parameterized mathematical family:

- spatial Lissajous curve
- torus knot
- trefoil knot
- spherical orbit
- three-dimensional harmonograph
- spatial hypotrochoid
- shell helix

The selected function becomes a coherent figure rather than a stack of unrelated
fields. Three-dimensional points are projected with perspective, and depth changes
the width of thin parallel contours. The figure is plotted with fully opaque repeated
digits, directional symbols, punctuation, and occasional cosmic marks rather than
heavy filled geometry.

Use `RANDOM VISUAL` to generate a new function, palette, parameters, and glyph system
without changing the writing.

The cover is a static image in both the live preview and the local publication.

## 3. Duotone theme selection
Each note now chooses an accessible minimal duotone palette from several soft combinations.

The chosen palette affects:
- interface background
- interface text
- preview background
- preview text
- exported publication
- background texture
- cover ASCII

## 4. Warmer synthesis
The local synthesis prompt is gentler and less clinical.

The last page now uses:
- `what returns`
- `pressure points`
- `movement`
- `undercurrent`
- `near`

instead of colder system language.

Everything else from v7 still holds:
- localhost:9999
- auto-save
- on-demand local analysis (the model loads only after `ANALYSIS` or `PUBLISH`)
- editable thought history through the archive selector
- one type size
- manual line breaks preserved
- publish JPG pages, MP4 synthesis pages, Markdown, and local-model traces through one button
