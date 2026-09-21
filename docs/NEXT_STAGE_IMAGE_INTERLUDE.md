# Next stage: image-to-ASCII interlude

## Desired sequence

For each explicit `ANALYSIS` or `PUBLISH` run, build the carousel in this order:

1. mathematical ASCII cover;
2. every manual-writing page;
3. one image-to-ASCII interlude for that AI response;
4. every paginated local-AI synthesis page.

The interlude is generated only after the local synthesis completes. Typing and
autosave must never trigger network image retrieval.

## Provider decision

Use The Met Collection API as the first provider. It needs no API key and exposes
public-domain object metadata plus JPEG URLs. Use the paginated
`/public/collection/v1.1/search` endpoint; the older v1 search is scheduled for
retirement on October 1, 2026.

- [The Met Collection API](https://metmuseum.github.io/)
- [The Met Open Access dataset](https://github.com/metmuseum/openaccess)

Keep providers behind one interface so Wikimedia Commons or a IIIF collection can
be added later. IIIF is useful when a provider exposes it because the image API can
request a bounded size and grayscale output without downloading an original-sized
asset.

- [IIIF Image API 3.0](https://iiif.io/api/image/3.0/)

## Component boundaries

```text
dist/image-synthesis/
  keywords.js          lexical candidates and normalization
  rank-candidates.js   deterministic query and artwork scoring
  image-loader.js      browser decoding into a p5 image
  providers/
    met.js             Met-specific response normalization
    index.js           provider contract and fallback order

dist/visual/
  image-field.js       grayscale/edge field; no provider knowledge

server/
  image-cache.mjs      fetch, validate, hash, and cache source JPEGs
  image-api.mjs        local-only search and cached-image endpoints
```

The renderer receives a normalized image-selection object. It must not call museum
APIs or know which provider supplied the image.

## Keyword candidates

Create several options, then rank them rather than trusting one source:

1. up to five recurring non-stopword terms from the article;
2. title terms with a strong bonus;
3. one or two concrete visual concepts returned by the local model;
4. paired phrases made from the strongest compatible terms;
5. single-term fallbacks when paired searches have no usable results.

Extend the local analysis result with:

```json
{
  "visualKeywords": [
    { "term": "night garden", "confidence": 0.88 },
    { "term": "threshold", "confidence": 0.71 }
  ]
}
```

Reject generic terms such as “thing,” “system,” “work,” or “idea.” The AI output is
advisory: lexical evidence remains available if the model returns an abstract or
invalid phrase.

## Query scoring

Normalize every score to 0–1 and use this initial weighting:

| Signal | Weight |
| --- | ---: |
| Local-AI confidence | 0.30 |
| Article frequency | 0.25 |
| Title occurrence | 0.20 |
| Phrase concreteness | 0.15 |
| Two-source agreement | 0.10 |

Query the highest-ranked options in order. Stop after three successful queries or
when twelve viable artwork records have been collected.

## Artwork scoring

Mandatory filters:

- `isPublicDomain === true`;
- a non-empty `primaryImageSmall` or `primaryImage`;
- an object page and credit metadata;
- a decodable JPEG under the configured byte limit.

Then rank:

| Signal | Weight |
| --- | ---: |
| Keyword overlap with title/tags/object name | 0.35 |
| Provider search rank | 0.20 |
| Simple removable background | 0.15 |
| Useful tonal range after grayscale conversion | 0.15 |
| Crop/aspect-ratio fitness for 4:5 | 0.10 |
| Highlight status | 0.05 |

Use `visualSeed` only as a deterministic tie-breaker. Reopening a saved thought must
reuse the persisted selection rather than silently choosing a different artwork.

## Image treatment

1. Fetch through the loopback server, validate MIME type and byte size, hash the
   response, and cache it locally.
2. Fit a centered crop to the interlude's safe area.
3. Convert to luminance.
4. Estimate the background from perimeter samples and remove only edge-connected
   pixels within a conservative color-distance threshold.
5. Reject the candidate and try the next one when background confidence is low;
   do not erase uncertain foreground detail.
6. Feed the resulting luminance and edge field into the same glyph ramp, spacing,
   margins, paper texture, and duotone renderer used by the cover.
7. In image mode, the source field is the image—not a blend with the mathematical
   function.

The interlude should be a static JPG. The following synthesis page keeps the typing
MP4 behavior.

## Persistence and credits

Store this under the thought's analysis record:

```json
{
  "imageSelection": {
    "provider": "met",
    "query": "night garden",
    "objectId": 123,
    "title": "...",
    "artist": "...",
    "objectUrl": "...",
    "imageUrl": "...",
    "creditLine": "...",
    "publicDomain": true,
    "cacheKey": "sha256:...",
    "scores": {}
  }
}
```

Include title, artist, provider, object URL, credit line, selected keywords, and
scores in the published Markdown trace. The visual page may use a small credit line
inside the existing margins if it remains legible.

## Failure behavior

- API unavailable: publish the existing carousel without an image interlude and
  preserve a structured failure reason in the local trace.
- No public-domain match: try the next query, then omit the page.
- Image decode or background-removal failure: try the next ranked artwork.
- Cached selection available: use it without a network request.
- Writing changes: invalidate the analysis and image selection together.

An unrelated fallback image is worse than no image.

## Test gates

Before enabling the feature by default:

1. unit-test keyword normalization, weighting, deterministic ties, provider
   normalization, and background-mask confidence;
2. contract-test Met v1.1 response handling with saved fixtures;
3. test offline/cached and no-result flows;
4. verify the carousel order for one-page and multi-page writing/synthesis;
5. verify no provider request occurs at startup or during typing;
6. verify every selected source is public-domain and credited in `index.md`;
7. visually inspect at least twelve fixtures: portrait, landscape, sculpture on a
   plain ground, dense painting, low contrast, dark ground, and irregular crop;
8. run the existing JPG/MP4 publication regression suite.
