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
# self-contained: boots its own throwaway host
node test/browser/run.mjs --boot

# or against an instance you already have
DSH_BROWSER_URL='http://127.0.0.1:3099/?token=…' npm run test:browser

node test/browser/run.mjs --url <url> --filter enter   # one check
node test/browser/run.mjs --url <url> --headful        # watch it
```

The URL is the tokenized one `dsh web` prints. `--boot` needs `dsh` on `PATH`;
it links this package into a temporary profile and tears the whole thing down
afterwards, so nothing of yours is touched.

## What `--boot` sets up, and why

A bare profile is not a usable phone host, and each gap made checks fail for a
reason unrelated to the plugin — so the runner closes them:

- **a workspace.** Without one the composer is replaced by a "choose a
  workspace" prompt, so the send button is inert and every composer assertion
  measures nothing.
- **the path recorded as a realpath.** On macOS both `/tmp` and `/var` are
  symlinks, so `mkdtempSync` returns `/var/folders/…` whose realpath is
  `/private/var/folders/…`. A workspace stored under the symlinked form never
  becomes usable — silently, with no error anywhere. This is worth knowing if
  you ever hand-write `storages/workspace.json`: store the realpath.
- **the browse directory picker pin.** `directory-picker-auto` samples the host
  once at boot, and a loopback bind on macOS resolves to the native backend, so
  "add workspace" opens Finder on the host. A host configured for phone access
  pins `browse` (see the main README); `--boot` writes that pin so the picker
  check is not asserting against a knowingly-wrong host.

## What they need

| | |
|---|---|
| Chrome | `/Applications/Google Chrome.app` by default; headless |
| `ws` | reused from the global dsh install, so there is nothing to `npm install` |
| `dsh` on PATH | only for `--boot` |
| model credentials | only for the checks that submit a message; `--boot` symlinks yours if present, and `ensureSession` creates a session when the host has none |

They are **not** part of `npm test` or CI: they need a browser, a live host, and
sometimes a model call. Run them by hand before a release.

Both paths are green: `--boot` and a prepared instance each pass **9/9**.

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
