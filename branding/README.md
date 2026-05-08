<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Branding assets

Canonical store for the Vantage Studio logo. The runtime SPA pulls
mirrored copies from `apps/ui/public/` so vite serves them at the
site root; this directory is the source-of-truth for releases,
README artwork, and external use.

| File               | Size          | Purpose                                                                                                                                            |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logo.png`         | 800 px wide   | Marketing artwork — README header, release notes, blog posts. Includes the wordmark + tagline.                                                     |
| `logo-medium.png`  | 400 px wide   | Mid-density use — slide decks, doc sidebar headers. Same composition as `logo.png`, just smaller.                                                  |
| `logo-mark.png`    | 256 px square | Tower-only mark, padded to 1:1. Use as an icon in places that already render the wordmark in text — app shells, social previews, GitHub repo icon. |
| `logo-mark-sm.png` | 64 px square  | Same mark at favicon-and-below density. Lossy-friendly — keeps the silhouette readable at 16 / 32 px.                                              |

The mark is a stylised air-traffic-control tower with an embedded
**VS** monogram in crimson, set in cool steel grey with cyan circuit
traces — the visual cue is "operator console / mission control for
SkyWalking's runtime-rule pipeline". The Studio app shell uses
`vs-logo.png` (mirrored from `logo-medium.png`) in the header and
`favicon.svg` (an abstracted VS letterform) for browser tabs.

Re-deriving the variants from a new master is a one-liner with
Pillow:

```python
from PIL import Image
src = Image.open('master.png').convert('RGBA')

full = src.copy(); full.thumbnail((800, 800)); full.save('logo.png', optimize=True)
med  = src.copy(); med.thumbnail((400, 400));  med.save('logo-medium.png', optimize=True)

# Tower-only square crop. Adjust (left, top, right, bottom) for the
# specific master — tower bbox in our 2816x1536 source is (1050, 50, 1750, 1100).
crop = src.crop((1050, 50, 1750, 1100))
side = max(crop.size); square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))

m256 = square.copy(); m256.thumbnail((256, 256)); m256.save('logo-mark.png', optimize=True)
m64  = square.copy(); m64.thumbnail((64, 64));    m64.save('logo-mark-sm.png', optimize=True)
```

License: same as the project (Apache-2.0). Trademark / brand
guidelines TBD; for now: don't alter the mark's geometry, don't
recolour outside the documented palette in
`packages/design-tokens/src/tokens.css`.
