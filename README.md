# Generative Thoughts

A local-first p5.js studio for turning intact writing into numbered, generative Instagram carousels.

## What works now

- Creates a passcode hash in this browser using Web Crypto.
- Saves drafts, the numbered index, patterns, and palettes in `localStorage`.
- Preserves the original text exactly while paginating it across 4:5 slides.
- Produces deterministic p5.js visuals from the writing, with a separate visual seed for randomization.
- Exports 1080 × 1350 PNG files, bundles full carousels as ZIPs, and uses the native share sheet when the browser supports it.
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

### Phase 2 — cross-device continuity

Add real authentication and an encrypted hosted database so the laptop and phone share one index. Keep local-first drafts for resilience.

### Phase 3 — Instagram publishing

Add a small server component for Meta's Instagram Content Publishing API. Access tokens must never be stored in browser code. Until then, `Share` is the safest low-friction mobile publishing path.

### Phase 4 — gentle machine intelligence

Start with an optional local “visual interpreter” that maps writing features—length, punctuation, repetition, and cadence—to pattern parameters. A later LLM can suggest non-destructive metadata such as a caption, alt text, or tags. The source thought should remain immutable and visibly separate from suggestions.

## Project structure

```text
dist/                  # authored site
  index.html
  styles.css
  app.js
  favicon.svg
site-dist/             # generated production build (ignored)
```

Run `npm run build` to generate `site-dist`, the folder GitHub Pages publishes.
