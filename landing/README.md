# v2all

A single-page subscription landing page. The real subscription URL is verified against the upstream v2all repository; the page does not invent live health measurements.

## Open

Open `dist/index.html` directly in a browser, or upload it to a static host. There is no installation or build step to use this file. The CSS, variable font, font license, and interaction script are embedded. The page makes no external requests on load.

## Source

- `src/App.tsx`: React page and content.
- `src/index.css`: visual system, responsive layout, and reduced-motion behavior.
- `src/interactions.ts`: shared clipboard handling, selection fallback, and reveal behavior.
- `index.html`: prerendered content, metadata, and no-JavaScript fallback.
- `scripts/prerender.tsx`: renders the React component into the static document.

Development uses React. Production uses the same prerendered markup with a small enhancement script instead of shipping a React runtime. This keeps the standalone document below the 200 KB budget and makes the content independent of JavaScript.

## Develop

Run `npm run dev`. After editing the React content, regenerate and build with `npx tsx scripts/prerender.tsx && npm run build`.

## Verify

Run `npx tsc --noEmit`. With the development server on port 5173 and `npm run preview` on port 4173, run `node scripts/verify.mjs`. If necessary, install the test browser with `npx playwright install --with-deps chromium`.

The verification script covers four viewport widths, the real clipboard, clipboard denial, the legacy fallback, keyboard navigation, contrast, reduced motion, scroll reveals, JavaScript-disabled content, a directly opened HTML file, and the development entry point. It writes screenshots and measured results to `artifacts/`.

## Scope

The page copies the public subscription published by `https://github.com/mahdyaralipor/v2all`. It does not operate proxies or guarantee that a server tested in upstream CI is reachable from a particular network. That limitation is stated on the page.

The display font is Space Grotesk under the SIL Open Font License 1.1. Its license is included in `src/assets/OFL.txt` and embedded in the production document.
