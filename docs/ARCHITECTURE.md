# Architecture

Generative Thoughts is a local-first browser studio served by a small loopback Node
server. Runtime writing, analysis, downloaded models, cached images, and published
media remain local and are not release source files.

## Browser

```text
dist/app.js                    UI event wiring and p5 lifecycle
dist/studio/state.js           in-memory state and crash recovery
dist/studio/archive-session.js serialized autosave and history switching
dist/studio/analysis-session.js on-demand local-model lifecycle
dist/studio/analysis-policy.js  explicit reuse, replace, and no-analysis policy
dist/studio/confirmation-dialog.js accessible destructive-action confirmation
dist/archive.js                small HTTP client for archive endpoints
dist/model-config.js           explicit local model IDs and validation
dist/ai.js                     local inference engine and prompt policy
dist/visuals.js                deterministic carousel rendering engine
dist/visual/image-field.js     provider-agnostic image luminance field
dist/export.js                 JPG/WebM capture and publish request
```

Rules:

- `app.js` wires components; it does not implement storage or inference.
- Only `analysis-session.js` may trigger the lazy AI import.
- Publishing never triggers analysis; it reuses saved analysis or asks to proceed without it.
- Re-analysis always requires confirmation before replacing saved analysis.
- Archive saves are serialized through one `archive-session` instance.
- Renderers consume state and normalized media; they do not call external APIs.
- Export rebuilds slides from saved state instead of trusting preview state.

## Loopback server

```text
local-server.mjs                 HTTP/Vite orchestration and route handlers
server/archive-format.mjs        thought Markdown codec
server/atomic-files.mjs          recoverable whole-file writes
server/publication-naming.mjs    stable publication paths and page names
```

The default host is loopback-only. The server owns filesystem writes and MP4
conversion; the browser owns canvas rendering and WebM recording.

## Runtime data

These paths are ignored by Git:

```text
public/models/    local model weights
data/index.json   embeddings, synthesis, traces, and media selections
thoughts/*.md     personal writing archive
published/        generated JPG, MP4, and Markdown artifacts
cache/            future fetched-image cache
```

`data/index.example.json` and `thoughts/.gitkeep` preserve the expected directory
shape without publishing personal content.

## Extension policy

New features should add a component at the relevant boundary and a test for its
public contract. Provider-specific image retrieval belongs under
`dist/image-synthesis/providers/` and `server/image-api.mjs`, not inside the visual
engine or `app.js`.
