# Generative Thoughts

A local-only p5.js publishing instrument for turning intact writing into numbered, diagrammatic Instagram carousels.

## What works now

- Saves drafts, the numbered index, patterns, and palettes in `localStorage`.
- Preserves the original text exactly while paginating it across 4:5 slides.
- Builds a sequence: animated diagram cover, indexed text pages, occasional pattern interruptions, and a local-signal record.
- Automatically chooses among axis, orbital, echo, directional, halftone, and constellation systems without altering a word.
- Scales each system from sparse to dense using text structure, semantic signal, and the current random seed.
- Uses the post title, length, punctuation, cadence, lexical density, and optional local sentence embedding to control the p5 equations.
- Counts posts in binary on the cover: `0`, `1`, `10`, `11`, …
- Exports the 1080 × 1350 cover as a four-second MP4 and the remaining pages as JPEG files, bundled together as a ZIP.
- Can publish a mixed 2–10 item carousel directly to an Instagram Business or Creator account through the included local server bridge.
- Uses Vite for a small, conventional build that is easy to extend with existing creative-coding libraries.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`. The server binds to the local machine only by default.

## Privacy model

There is no account or password. Writing and the index remain in this browser's `localStorage`; credentials remain in the ignored `.env.local` file. Clearing browser site data removes the writing, and it does not automatically sync between devices.

## Product path

### Phase 1 — this prototype

Write, index, randomize, and publish without an account. The visual engine is p5.js in instance mode so each pattern can grow into a reusable sketch module.

### Direct Instagram publishing

Instagram tokens never enter browser code. Put the following values in the ignored `.env.local` file:

- `INSTAGRAM_USER_ID`
- `INSTAGRAM_USERNAME`
- `INSTAGRAM_ACCESS_TOKEN`
- `BLOB_READ_WRITE_TOKEN`

The Instagram account must be a Business or Creator account and the Meta app/token must have `instagram_business_basic` and `instagram_business_content_publish`. Although the studio is local, Instagram must fetch carousel media from a public URL; the local server therefore uploads the MP4 and JPEG files temporarily to Vercel Blob, publishes the post, then deletes them.

To access the studio from a phone on the same Wi-Fi network, set `LOCAL_HOST=0.0.0.0`, start the server, and open the computer's LAN address. This exposes it to the local network, not the public internet.

### Local machine intelligence

A quantized MiniLM sentence-embedding model loads automatically after writing pauses. Inference runs in the browser; the resulting vector becomes a binary semantic signature and additional pattern parameters. The text is never rewritten. The first run downloads the model and caches it in the browser.

### Cross-device continuity

The current index remains device-local. A later sync layer can add real authentication and encrypted storage without changing the carousel generator.

## Project structure

```text
dist/                  # authored site
  index.html
  styles.css
  app.js
  favicon.svg
site-dist/             # generated production build (ignored)
api/instagram/         # Instagram publishing handlers
local-server.mjs       # loopback-only application and API server
```

Run `npm run build` to verify the production bundle locally.
