# Browser checks

These drive a real dsh instance in a real headless Chrome at phone viewports.
They exist because the plugin's most expensive bugs were invisible to every
other kind of test:

- an overlay that **painted correctly but answered no taps** (the settings sheet
  inherited `pointer-events: none` from the sidebar it is rendered inside), so
  the app looked frozen;
- a fixed, full-viewport column that kept **hit-testing while its panel was
  hidden**, swallowing every tap on the page;
- a keyboard inset measured against the wrong viewport, which **lifted the
  composer to the top of the screen** on Android;
- a keyboard inset that oscillated, producing a **white band flickering** along
  the bottom edge;
- the directory picker opening **on the host's screen instead of the browser's**.

Geometry assertions and screenshots prove none of those. A hit test, a mutation
count and a real tap do.

## Running

```bash
# against an instance you already have
DSH_BROWSER_URL='http://127.0.0.1:3099/?token=…' npm run test:browser

# or let it boot a throwaway host in a scratch DSH_HOME
node test/browser/run.mjs --boot

node test/browser/run.mjs --url <url> --filter enter   # one check
node test/browser/run.mjs --url <url> --headful        # watch it
```

The URL is the tokenized one `dsh web` prints. `--boot` needs `dsh` on `PATH`
and links this package into a temporary profile, so nothing of yours is touched.

## What they need

| | |
|---|---|
| Chrome | `/Applications/Google Chrome.app` by default; headless |
| `ws` | reused from the global dsh install, so there is nothing to `npm install` |
| a host | with this plugin active |
| a workspace + at least one session | for the checks that open the explorer or the header |
| model credentials | only for the checks that submit a message |

They are **not** part of `npm test` or CI: they need a browser, a live host, and
sometimes a model call. Run them by hand before a release.

## The checks

| file | what it proves |
|---|---|
| `01-smoke` | across 7 viewports: one full-width column, no horizontal overflow, a working drawer, ≥16px composer font, a single-line control row, and nav/send/composer actually reachable |
| `02-simple` | the decluttered chrome: tools/stats hidden by default, the reveal toggle works, the header loses the Finder and download controls, desktop keeps everything |
| `03-icons` | Material Icon Theme icons paint on every explorer row, the app's own glyph is hidden, folders swap to the open variant |
| `04-enter` | Enter inserts a newline on mobile; Shift+Enter too; Ctrl+Enter and the Send button still submit; the `/` menu still owns Enter; desktop is unchanged |
| `05-quiet` | the plugin writes **nothing** while the app is idle, including after a theme switch |
| `06-vv` | the keyboard inset across three platform behaviours, and 0 writes from URL-bar oscillation |
| `07-cycles` | every overlay — file manager, settings, drawer, nested — returns an interactive main surface |
| `08-composer-kb` | the composer stays at the keyboard edge, not lifted by a double-counted inset |
| `09-picker` | "add workspace" opens a dialog **in the browser** |

## Writing one

Export `run(page, url)`; use `createReporter` for failure collection and the
helpers in `../harness.mjs`. Two rules the helpers encode, both learned by
getting them wrong:

1. **A blank session hides the header** (`headerHidden` → `display:none`), so
   header assertions pass vacuously. Send a message first
   (`makeSessionNonBlank`) and assert the header is visible before checking it.
2. **Submitting changes the world.** Each case that asserts a delta needs a
   fresh page — a running agent alters composer behaviour and grows the
   transcript on its own.
