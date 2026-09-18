# Generative Thoughts

A local-first p5.js publishing instrument for turning intact writing into numbered, diagrammatic Instagram carousels.

Production app: [generative-thoughts.vercel.app](https://generative-thoughts.vercel.app)

## What works now

- Creates a passcode hash in this browser using Web Crypto.
- Saves drafts, the numbered index, patterns, and palettes in `localStorage`.
- Preserves the original text exactly while paginating it across 4:5 slides.
- Builds a sequence: animated diagram cover, indexed text pages, occasional pattern interruptions, and a local-signal record.
- Translates the writing into orbital diagrams, directional fields, or low-resolution halftone fields without altering a word.
- Uses the post title, length, punctuation, cadence, lexical density, and optional local sentence embedding to control the p5 equations.
- Counts posts in binary on the cover: `0`, `1`, `10`, `11`, …
- Exports the 1080 × 1350 cover as a four-second MP4 and the remaining pages as JPEG files, bundled together as a ZIP.
- Can publish a mixed 2–10 item carousel directly to an Instagram Business or Creator account through the included secure server bridge.
- Uses Vite for a small, conventional build that is easy to extend with existing creative-coding libraries.

## Run locally

```bash
npm run dev
```

Then open the URL Vite prints. Use the `Network` URL from a phone on the same Wi-Fi network.

## Privacy model

The passcode is a personal privacy gate, not server authentication. Its salted hash and all writing are stored in the browser. The repository and deployed site never contain the thoughts you write. Clearing site data removes the work, and data does not automatically sync between a laptop and phone.

## Product path

### Phase 1 — this prototype

Write, index, randomize, export, and share without an account or backend. The visual engine is p5.js in instance mode so each pattern can grow into a reusable sketch module.

### Direct Instagram publishing

Instagram tokens must never be stored in browser code. Deploy the repository to Vercel, provision Vercel Blob, and configure the values in `.env.example` as server environment variables:

- `INSTAGRAM_USER_ID`
- `INSTAGRAM_USERNAME`
- `INSTAGRAM_ACCESS_TOKEN`
- `PUBLISH_SECRET` — use the same phrase as the local studio passphrase
- `BLOB_READ_WRITE_TOKEN`
- `ALLOWED_ORIGIN`

The Instagram account must be a Business or Creator account and the Meta app/token must have `instagram_business_basic` and `instagram_business_content_publish`. The server temporarily hosts the MP4 and JPEG files, creates the carousel containers, publishes the post, then deletes the temporary files.

GitHub Pages continues to host the static studio. In `INSTAGRAM_OUTPUT`, set the deployed Vercel URL as the publish server. If the entire app is hosted on Vercel, leave the server URL blank.

### Local machine intelligence

`RUN LOCAL MODEL` loads a quantized MiniLM sentence-embedding model through Transformers.js. Inference runs in the browser; the resulting vector becomes a binary semantic signature and additional pattern parameters. The text is never rewritten. The first run downloads the model and caches it in the browser.

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
api/instagram/         # secure Vercel publishing functions
```

Run `npm run build` to generate `site-dist`, the folder GitHub Pages publishes.
