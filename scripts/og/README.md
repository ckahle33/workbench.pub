# Share card and icons

`og.html` is the source of `public/og.png`, the default link-preview image (1200x630, PNG). `icon.html`
draws `public/favicon.svg` at 180x180 for `public/apple-touch-icon.png`, which `make-ico.py` downscales into `public/favicon.ico` (PNG-in-ICO, 32x32 and 16x16). Both use the repo's self-hosted
fonts straight from `node_modules` (Inter Tight variable 800, IBM Plex Mono 500), so run `npm install` first.

Render both with headless Chrome (macOS path by default; set `CHROME` to another binary elsewhere):

```sh
sh scripts/og/render.sh
```

The script screenshots each page at device scale 1 with `--allow-file-access-from-files` (so the
`file://` fonts load) and a 5 s virtual time budget (so they finish loading before the shot). The
output was about 46 KB for og.png, so no further compression was needed; keep it under 150 KB.

If you change the card's words, update `DEFAULT_IMAGE_ALT` in `functions/shareMeta.ts` and the
`og:image:alt` / `twitter:image:alt` tags in `index.html` to match (a test checks they agree).
