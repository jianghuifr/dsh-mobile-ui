/**
 * Browser half of `@jianghuifr/dsh-mobile-ui` — the whole plugin.
 *
 * ## Why a stylesheet plus a small runtime
 *
 * The shipped web client has no viewport-width CSS at all. Its only mobile
 * adaptation is JavaScript: `AppFrame` collapses the sidebar below 1024px and
 * `computeColumns` keeps a permanent 56px rail plus a 400px centre floor. On a
 * 390px phone that leaves a 334px content column, and `--dsh-chat-content-width`
 * still floors at 680px inside it.
 *
 * Everything this plugin changes is therefore *presentation* — geometry, hit
 * sizes, gesture affordances — so the bulk of it is one stylesheet. A handful of
 * things cannot be expressed in CSS against a DOM the plugin does not own:
 *
 * - **`grid-template-columns` is written inline** by `AppFrame` from measured
 *   widths, so collapsing the grid to one column needs `!important` *and* a
 *   stable hook on the frame element. The runtime tags elements instead of
 *   hard-coding the app's per-module CSS-module hashes, which change per build.
 * - **The sidebar has no off-canvas mode.** It is a grid track, so "open" can
 *   only mean "wider track". To make it an overlay drawer the plugin hides the
 *   track, positions the column fixed, and drives the app's own toggle button so
 *   the app still believes it is doing the expanding. Closing is sequenced so
 *   the app's rail never flashes inside the sliding drawer.
 * - **iOS never resizes the layout viewport for the keyboard**, and nothing in
 *   the app listens to `visualViewport`, so the composer would sit under the
 *   keyboard.
 * - **There is no affordance to open the sidebar once the rail is hidden**, so
 *   the runtime injects one navigation button.
 * - **`viewport-fit=cover`** is missing from the viewport meta, so
 *   `env(safe-area-inset-*)` is always zero and the notch/home-indicator areas
 *   are unusable.
 *
 * ## Contract notes
 *
 * This file is a **client bundle**: it must be a classic script that registers a
 * factory and does nothing else at the top level (no `import`, no top-level
 * `require`, no side effects — those belong inside the factory, which runs at
 * materialization). The registered `id` must equal the Loader row id, which is
 * the package name.
 *
 * `inject` is empty on purpose: the plugin reads the DOM and the app's own
 * `data-*` hooks, never a Cordis service, so it must not wait on one.
 *
 * @module @jianghuifr/dsh-mobile-ui/client
 */

window.__ModuleLoader__.load({
  // Must equal the package name in package.json — client-modules uses that as
  // the graph entry id, and the runtime rejects a bundle that registers
  // anything else ("loaded without registering ... via __ModuleLoader__.load").
  id: '@jianghuifr/dsh-mobile-ui',
  // No `require` parameter: this plugin needs nothing from the platform module
  // table, so it declares no externals and never resolves a specifier. The
  // module system calls the factory with one regardless; taking no argument is
  // what keeps that honest.
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    /** Owning package id — also the `data-plugin` tag on the injected style. */
    const PLUGIN_ID = '@jianghuifr/dsh-mobile-ui';
    /** Matches the app's own `SIDEBAR_AUTO_COLLAPSE`, so both agree on "narrow". */
    const MOBILE_QUERY = '(max-width: 1023px)';
    /** Icon route served by this package's host half (see `lib/index.js`). */
    const ICON_ROUTE = '/material-icons';
    /** Depth of the notch/home-indicator padding, in px, applied to the drawer. */
    const EDGE_ZONE = 24;
    /** Horizontal travel that counts as a drawer swipe, in px. */
    const SWIPE_MIN = 56;
    /** A pointer that moves more than this before the swipe threshold is a scroll. */
    const SWIPE_SLOP = 14;
    /** Must match `--dshm-dur` in the stylesheet. */
    const DRAWER_MS = 280;
    /** Longer than any panel transition, for the post-animation re-check. */
    const SETTLE_MS = 450;
    /** Hidden viewport height at which a keyboard is believed to be up. */
    const KEYBOARD_ENGAGE = 140;
    /** ...and at which it is believed to be gone. The gap is the dead band. */
    const KEYBOARD_RELEASE = 70;

    const CSS = `
/* =====================================================================
   @jianghuifr/dsh-mobile-ui — mobile layout, styling and touch layer
   ---------------------------------------------------------------------
   Everything is scoped to html[data-dsh-mobile="true"], which the runtime
   sets from (max-width: 1023px). A desktop window is never touched.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. Local tokens.
   The app publishes colour and font tokens but no spacing/size scale, so
   geometry lives here rather than being re-hard-coded per rule.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] {
  --dshm-drawer-w: min(86vw, 320px);
  --dshm-safe-top: env(safe-area-inset-top, 0px);
  --dshm-safe-bottom: env(safe-area-inset-bottom, 0px);
  --dshm-safe-left: env(safe-area-inset-left, 0px);
  --dshm-safe-right: env(safe-area-inset-right, 0px);
  --dshm-fab: 40px;
  --dshm-tap: 44px;
  --dshm-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --dshm-dur: ${DRAWER_MS}ms;
  --dshm-fast: 140ms;
  --dshm-kb: 0px;
  --dshm-backdrop: rgba(0, 0, 0, 0.5);
  --dshm-nav-z: 57;
  --dshm-backdrop-z: 55;
  --dshm-drawer-z: 60;
}

/* ---------------------------------------------------------------------
   1. Document foundations: dynamic viewport height, no rubber-banding,
   no double-tap zoom delay, no grey tap flash.
   --------------------------------------------------------------------- */
/* The app never sets box-sizing, so it is content-box throughout and any
   width this stylesheet pins is a *content* width that padding then adds
   to. Everything given an explicit width here opts into border-box. */
html[data-dsh-mobile='true'] :is(
    [data-dsh-part='frame'],
    [data-dsh-part='sidebarCol'],
    [data-dsh-part='rightbarCol'],
    [data-dsh-part='nav'],
    [class*='_dialog'],
    [class*='_confirmation']
  ),
html[data-dsh-mobile='true'] :has(> nav[class*='_nav']),
html[data-dsh-mobile='true'] :has(> nav[class*='_nav']) :is(nav, [class*='_content'], [class*='_options']) {
  box-sizing: border-box;
}
html[data-dsh-mobile='true'] {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
html[data-dsh-mobile='true'] body {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}
html[data-dsh-mobile='true'] #root {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}
html[data-dsh-mobile='true'] :is(a, button, [role='button'], [role='tab'], [role='treeitem'], [role='menuitem'], [tabindex], summary, label) {
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

/* ---------------------------------------------------------------------
   2. Frame: three tracks become one. The side columns stop being layout
   and become overlays, so the content column gets the whole viewport.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] [data-dsh-part='frame'] {
  grid-template-columns: minmax(0, 1fr) !important;
  box-sizing: border-box;
  height: 100%;
  padding-bottom: var(--dshm-kb);
  transition: padding-bottom 0.18s var(--dshm-ease);
}
html[data-dsh-mobile='true'] [data-dsh-part='centerCol'] {
  min-width: 0;
}
/* 8px drag strips: unhittable, and they swallow horizontal gestures. */
html[data-dsh-mobile='true'] [data-dsh-part='frame'] > [class*='_handle'] {
  display: none !important;
}
html[data-dsh-mobile='true'] [class*='_widthHandle'] {
  display: none !important;
}

/* ---------------------------------------------------------------------
   3. Sidebar as an off-canvas drawer.
   Open/closed is mirrored onto <html> by the runtime because the app
   expresses it as the *absence* of data-sidebar-collapsed, which cannot
   be selected for. Closed state also covers the rail: with the track gone
   the rail would otherwise paint over the content column.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] [data-dsh-part='sidebarCol'] {
  position: fixed;
  top: 0;
  bottom: 0;
  left: calc(-1 * (var(--dshm-drawer-w) + 16px));
  width: var(--dshm-drawer-w) !important;
  max-width: var(--dshm-drawer-w);
  z-index: var(--dshm-drawer-z);
  display: block;
  overflow: hidden;
  border-right: 0;
  padding-top: var(--dshm-safe-top);
  padding-bottom: var(--dshm-safe-bottom);
  padding-left: var(--dshm-safe-left);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  pointer-events: none;
  /* Deliberately no transform, filter, perspective or will-change here.
     Any of them would make this column the containing block for
     position: fixed, and the settings dialog renders *inside* the sidebar —
     it would shrink to the drawer's box and could never cover the screen.
     Sliding the left offset costs a little more per frame but keeps the
     column out of the containing-block chain. visibility: hidden is avoided
     for the same reason: it would hide those fixed descendants too. */
  transition:
    left var(--dshm-dur) var(--dshm-ease),
    box-shadow var(--dshm-dur) var(--dshm-ease);
}
html[data-dsh-mobile='true'][data-dsh-drawer='open'] [data-dsh-part='sidebarCol'] {
  left: 0;
  pointer-events: auto;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.44),
    0 2px 10px rgba(0, 0, 0, 0.3);
}
/* The settings dialog is rendered *inside* the sidebar, and pointer-events is
   inherited: with the drawer parked off-screen the dialog painted perfectly but
   answered no taps and would not scroll, because every point hit the
   conversation behind it.
   Two independent mechanisms, because one stale sample must never be able to
   freeze the screen again: a structural rule that needs no runtime state at
   all, and the runtime flag for anything the rule does not recognise. */
html[data-dsh-mobile='true'] [data-dsh-part='sidebarCol'] [class*='_overlay']:is(:has([class*='_navCell']), :has([class*='_dialog']), :has([class*='_mask'])) {
  pointer-events: auto;
}
html[data-dsh-mobile='true'][data-dsh-modal='true'] [data-dsh-part='sidebarCol'] {
  pointer-events: auto;
}
/* The sidebar root carries an inline width while "wide"; make it fill the drawer. */
html[data-dsh-mobile='true'] [data-dsh-part='sidebarRoot'] {
  width: 100% !important;
  height: 100%;
  --dsh-sidebar-inline-padding: 14px;
}
@media (prefers-reduced-motion: reduce) {
  html[data-dsh-mobile='true'] [data-dsh-part='sidebarCol'] {
    transition-duration: 1ms;
  }
}

/* Scrim behind the drawer. Present in the DOM always; only visible here. */
[data-dsh-part='backdrop'] {
  position: fixed;
  inset: 0;
  z-index: var(--dshm-backdrop-z, 55);
  opacity: 0;
  pointer-events: none;
  background: var(--dshm-backdrop, rgba(0, 0, 0, 0.5));
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  transition: opacity var(--dshm-dur, 280ms) var(--dshm-ease, ease);
}
html[data-dsh-mobile='true'][data-dsh-drawer='open'] [data-dsh-part='backdrop'] {
  opacity: 1;
  pointer-events: auto;
}

/* ---------------------------------------------------------------------
   4. Navigation affordance.
   Hiding the rail removes the only way to reach the session list, so the
   runtime injects this button. It floats, so React re-renders cannot eat
   it and no layout depends on it.
   --------------------------------------------------------------------- */
[data-dsh-part='nav'] {
  position: fixed;
  top: calc(var(--dshm-safe-top, 0px) + 8px);
  left: calc(var(--dshm-safe-left, 0px) + 8px);
  z-index: 57;
  display: none;
  align-items: center;
  justify-content: center;
  width: var(--dshm-fab, 40px);
  height: var(--dshm-fab, 40px);
  margin: 0;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 50%;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #fff) 84%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.6);
  backdrop-filter: blur(14px) saturate(1.6);
  color: var(--dsw-alias-label-primary, currentColor);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  transition:
    opacity var(--dshm-fast, 140ms) var(--dshm-ease, ease),
    transform var(--dshm-fast, 140ms) var(--dshm-ease, ease);
}
/* Expand the 40px visual to a 48px target without moving anything. */
[data-dsh-part='nav']::before {
  content: '';
  position: absolute;
  inset: -4px;
}
[data-dsh-part='nav'] svg {
  display: block;
  width: 20px;
  height: 20px;
}
html[data-dsh-mobile='true'] [data-dsh-part='nav'] {
  display: inline-flex;
}html[data-dsh-mobile='true'][data-dsh-drawer='open'] [data-dsh-part='nav'] {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.88);
}
/* The right panel is a full-screen sheet whose own tab strip starts in the
   same corner; the button would sit on top of the first tab. The open state
   cannot be expressed as a selector: the panel keeps its mode marker while
   hidden, so the runtime mirrors the computed visibility onto the root. */
html[data-dsh-mobile='true'][data-dsh-rightpanel='open'] [data-dsh-part='nav'] {
  opacity: 0;
  pointer-events: none;
}
[data-dsh-part='nav']:active {
  transform: scale(0.9);
}

/* ---------------------------------------------------------------------
   5. Conversation header.
   Compact, and indented on the left so the nav button never sits on the
   breadcrumb. The hero state renders no header at all, so this is a
   no-op there.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] {
  min-height: 0 !important;
  padding: 8px 6px 0 56px !important;
  border-bottom-color: var(--dsw-alias-border-l1);
}
/* The title row is width:100% with its own horizontal padding, and content-box
   adds that padding on top — 16px of overflow that pushes the right-panel
   toggle off the screen, where no tap can reach it. Its children also need to
   be allowed to shrink: they are sized for a desktop row with room to spare. */
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'],
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] * {
  box-sizing: border-box;
}
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_titleRow'] {
  gap: 4px;
  /* The row's own 8px side padding is what puts its content box 16px wider
     than the row, which is exactly the amount the corner button overflows by. */
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_titleCluster'],
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_titleCluster'] > * {
  min-width: 0;
  overflow: hidden;
}
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] :is([class*='_headerCorner'], [class*='_headerUtilities'], [class*='_headerActions']) {
  flex: 0 0 auto;
}
/* The corner button is pulled 16px past the row's right edge with a negative
   margin, expecting the header's 28px desktop padding to absorb it. At phone
   width that puts a fifth of the button off screen, where it cannot be tapped. */
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_headerCorner'] {
  margin-right: 0 !important;
  margin-left: 4px !important;
}
/* The expand button carries the same optical overhang; without this its hit
   area starts outside the corner box and half of it is off screen. */
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_headerCorner'] > button {
  margin: 0 !important;
}
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_headerUtilities'] {
  margin-left: 8px !important;
}
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_tabs'] {
  padding-left: 0;
  gap: 4px;
}
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] [class*='_tab'] {
  min-height: 36px;
  padding-left: 12px;
  padding-right: 12px;
}

/* ---------------------------------------------------------------------
   6. Transcript.
   --dsh-chat-content-width floors at 680px and has no viewport term, so
   inside a ~360px column every message row overflows its box. Clearing
   the composer's side clearance also buys back 64px of reading width.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] [data-conversation-scroll] {
  --dsh-chat-content-width: 100%;
  --dsh-composer-side-clearance: 0px;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}
html[data-dsh-mobile='true'] [data-conversation-scroll] [class*='_column'] {
  max-width: 100% !important;
}
/* The "jump to latest" pill is sticky to the bottom of the scroller, and the
   composer is sticky to the same edge with a lower z-index — so at this width
   the pill lands on top of the composer's own buttons. The app publishes the
   composer's measured height as an inherited custom property; float the pill
   just above it and pin it right, where it overlaps no text. */
html[data-dsh-mobile='true'] [data-conversation-scroll] [class*='_toBottomSlot'] {
  bottom: calc(var(--dsh-composer-height, 0px) + 10px + var(--dshm-safe-bottom));
  width: 100% !important;
  justify-content: flex-end;
  box-sizing: border-box;
  padding-right: 12px;
}
/* The element type is in the selector because "_toBottomSlot" also contains
   "_toBottom": a bare [class*=] would size the slot as well as the pill. */
html[data-dsh-mobile='true'] [data-conversation-scroll] button[class*='_toBottom'] {
  width: var(--dshm-tap);
  height: var(--dshm-tap);
  margin-top: calc(-1 * var(--dshm-tap));
}

/* Code blocks, tables and images must scroll inside the column, never
   widen it. */
html[data-dsh-mobile='true'] [data-conversation-scroll] :is(pre, table, .katex-display) {
  max-width: 100%;
}
html[data-dsh-mobile='true'] [data-conversation-scroll] img {
  max-width: 100%;
  height: auto;
}

/* ---------------------------------------------------------------------
   7. Composer.
   iOS zooms the viewport whenever a focused editable is under 16px; the
   composer's contenteditable inherits 14px from its card, so every tap
   into the message box used to zoom the whole app.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] [data-composer-seat] {
  padding-bottom: var(--dshm-safe-bottom);
}
html[data-dsh-mobile='true'] [data-composer-seat] [class*='_root'] {
  padding-left: 10px;
  padding-right: 10px;
}
html[data-dsh-mobile='true'] [class*='_card'] [contenteditable='true'],
html[data-dsh-mobile='true'] [class*='_input'][contenteditable='true'],
html[data-dsh-mobile='true'] textarea,
html[data-dsh-mobile='true'] input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']) {
  font-size: max(16px, var(--dsh-content-font-size, 16px)) !important;
}
html[data-dsh-mobile='true'] [class*='_placeholder'] {
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
/* Composer controls: 28px chips and a 34px send button are mouse targets.
   The row must still fit one line at 360px, so the chips grow only to 36px
   and the gaps tighten to pay for the 44px send button. */
html[data-dsh-mobile='true'] [data-composer-seat] [class*='_primary'] {
  width: var(--dshm-tap);
  height: var(--dshm-tap);
  min-width: var(--dshm-tap);
}
html[data-dsh-mobile='true'] [data-composer-seat] [class*='_add'] {
  width: 36px;
  height: 36px;
  min-width: 36px;
}
html[data-dsh-mobile='true'] [data-composer-seat] :is([class*='_select'], [class*='_trigger']) {
  min-height: 36px;
}
html[data-dsh-mobile='true'] [data-composer-seat] :is([class*='_row'], [class*='_tools'], [class*='_modes'], [class*='_trailing']) {
  gap: 8px;
}
html[data-dsh-mobile='true'] [data-composer-seat] [class*='_row'] {
  padding-left: 6px;
  padding-right: 6px;
  /* The app spreads this row with space-between across two items. Once the
     reveal toggle and the tool group are both present there are three, and a
     wrapped row then strands the toggle at one edge and the tools at the other,
     reading as two unrelated clusters. Packing from the start keeps the toggle
     and its tools together; the trailing group still lands hard right because
     of its own margin-left: auto. */
  justify-content: flex-start !important;
  row-gap: 4px;
}
/* When the row does wrap, the trailing group should land as a tidy
   right-aligned line rather than anywhere the flex algorithm drops it. */
html[data-dsh-mobile='true'] [data-composer-seat] [class*='_trailing'] {
  margin-left: auto;
  justify-content: flex-end;
  min-width: 0;
}
/* The model chip drops its container-query collapse somewhere above 360px and
   renders the whole model name, which is what pushes the row onto two lines at
   412px and up. Cap it so the row stays single-line on every phone. */
html[data-dsh-mobile='true'] [data-composer-seat] [class*='_trailing'] [class*='_trigger'] {
  max-width: 104px;
  min-width: 0;
}
html[data-dsh-mobile='true'] [data-composer-seat] [class*='_trailing'] [class*='_trigger'] * {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------------
   8. Touch ergonomics: hit sizes and press feedback.
   Session rows are 32px, tool rows 24px, and :active exists on exactly
   two elements in the whole app.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] :is([class*='_sessionRow'], [class*='_projectRow'], [class*='_searchResultRow']) {
  min-height: var(--dshm-tap);
}
html[data-dsh-mobile='true'] :is([class*='_treeitem'], [class*='_panelRow']) {
  min-height: 44px;
}
html[data-dsh-mobile='true'] :is(button, [role='button'], [role='tab'], [role='treeitem'], [role='menuitem'], a[href]) {
  transition: opacity var(--dshm-fast) var(--dshm-ease), background-color var(--dshm-fast) var(--dshm-ease);
}
html[data-dsh-mobile='true'] :is(button, [role='button'], [role='tab'], [role='treeitem'], [role='menuitem'], a[href]):active {
  opacity: 0.6;
}
html[data-dsh-mobile='true'] :is(button[class*='_iconButton'], button[class*='_action'], button[class*='_tab']):active {
  transform: scale(0.92);
}

/* Controls that only appear on :hover can never be reached by touch.
   The app gates exactly one of these behind (pointer: coarse); unhide the
   rest so their function exists at all. */
@media (hover: none), (pointer: coarse) {
  html[data-dsh-mobile='true'] :is([class*='_rowActions'], [class*='_chevron'], [class*='_headerActionsHidden'], [class*='_headerActions']) {
    display: inline-flex !important;
  }
  html[data-dsh-mobile='true'] :is([class*='_inspectButton'], [class*='_chevronHover'], [class*='_iconIdle']) {
    opacity: 1 !important;
  }
  html[data-dsh-mobile='true'] [class*='_panelIcon'] {
    display: inline !important;
  }
  html[data-dsh-mobile='true'] [class*='_railMark'] {
    display: none;
  }
  /* Tooltips latch on touch and cover the row that opened them. */
  html[data-dsh-mobile='true'] [role='tooltip'] {
    display: none !important;
  }
}

/* Tool rows: the 24px disclosure line is the main transcript affordance. */
html[data-dsh-mobile='true'] :is([class*='_callRow'], [class*='_row'][class*='_ToolRow'], [class*='_o3BgMG_row']) {
  min-height: 40px;
}
html[data-dsh-mobile='true'] [class*='_turnStatus'] {
  border-radius: 10px;
}

/* Long-press selection is legitimate on a phone; the app disables it on
   the two most text-dense surfaces. */
html[data-dsh-mobile='true'] :is([class*='_sessionRow'], [class*='_projectRow'], [class*='_row_luwio']) {
  -webkit-user-select: text;
  user-select: text;
}

/* ---------------------------------------------------------------------
   9. Overlays: dialogs become full-height sheets, menus are clamped to
   the viewport, and everything that reaches an edge clears the notch.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] :is([class*='_dialog'], [class*='_confirmation']) {
  width: 100% !important;
  max-width: 100% !important;
  max-height: calc(100dvh - var(--dshm-safe-top) - 12px) !important;
  border-radius: 20px 20px 0 0 !important;
}
html[data-dsh-mobile='true'] :is([class*='_mask'], [class*='_overlay']):has([class*='_dialog']) {
  padding: 0 !important;
  align-items: flex-end !important;
}
html[data-dsh-mobile='true'] :is([class*='_toast']) {
  top: calc(var(--dshm-safe-top) + 12px) !important;
  width: calc(100vw - 24px);
  max-width: none;
  border-radius: 14px;
}
html[data-dsh-mobile='true'] :is([class*='_menu'], [class*='_portal'], [class*='_panel'][class*='_JObwrW']) {
  max-width: calc(100vw - 16px) !important;
  max-height: min(70dvh, 460px) !important;
  overscroll-behavior: contain;
}
html[data-dsh-mobile='true'] [role='menu'] {
  max-height: min(70dvh, 460px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* The right drawer can only ever be an overlay at this width, so give it
   the whole sheet and the edge insets instead of a 100%-wide overhang.
   Its column has to leave the grid too: with one track the column would
   otherwise be auto-placed into a zero-height second row, and the panel
   (absolute against it) would collapse to nothing.

   Interaction is decided here entirely by CSS, on purpose. The column spans
   the viewport in *both* states, so it must never hit-test; the panel
   re-enables itself, which is safe because a closed panel is
   visibility: hidden and therefore not hit-testable anyway. Deriving this
   from a JS-sampled flag instead means the whole screen freezes for as long
   as that sample is stale — which is exactly what happened when the flag
   lagged a panel transition. */
html[data-dsh-mobile='true'] [data-dsh-part='rightbarCol'] {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 45;
  pointer-events: none;
}
html[data-dsh-mobile='true'] [data-dsh-part='rightbarCol'] [class*='_panel'] {
  position: absolute;
  inset: 0;
  width: 100% !important;
  max-width: 100%;
  pointer-events: auto;
}
html[data-dsh-mobile='true'] :is([data-sidebar-right-open], [data-sidebar-right-panel]) {
  padding-top: var(--dshm-safe-top);
  padding-bottom: var(--dshm-safe-bottom);
  border-left: 0;
}
html[data-dsh-mobile='true'] [class*='_float'] {
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 80px);
}

/* ---------------------------------------------------------------------
   10. Settings.
   A fixed two-column layout (164px nav + content) inside an 800px panel;
   at 390px the content column collapses to roughly two characters per
   line. Stack it and make the panel a full-screen sheet.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] :is([class*='_overlay']):has([class*='_navCell']) {
  padding: 0 !important;
  align-items: stretch !important;
  justify-content: stretch !important;
}
html[data-dsh-mobile='true'] :is([class*='_panel']):has([class*='_navCell']) {
  width: 100vw !important;
  max-width: 100vw !important;
  height: 100dvh !important;
  max-height: 100dvh !important;
  border-radius: 0 !important;
  padding-top: var(--dshm-safe-top);
  padding-bottom: var(--dshm-safe-bottom);
}
/* The settings body is a two-column flex: a fixed 164px nav beside the
   content. At 390px the content column collapses to about two characters
   per line. The nav is a real <nav> element, so anchor on that rather than
   counting :has() levels — the panel that owns it is the element that has
   to change axis, and its children are exactly [nav, content]. */
html[data-dsh-mobile='true'] :has(> nav[class*='_nav']) {
  flex-direction: column !important;
  min-height: 0;
}
html[data-dsh-mobile='true'] :has(> nav[class*='_nav']) > nav {
  flex: 0 0 auto !important;
  width: 100% !important;
  height: auto !important;
  min-width: 0 !important;
  border-right: 0 !important;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
html[data-dsh-mobile='true'] :has(> nav[class*='_nav']) > :not(nav) {
  flex: 1 1 auto !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
}
html[data-dsh-mobile='true'] :has(> nav[class*='_nav']) > :not(nav) > [class*='_options'] {
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  /* Column flex items default to min-height: auto, so the list refuses to
     shrink below its content and pushes 38px past the bottom of the sheet
     instead of scrolling. */
  min-height: 0 !important;
}
html[data-dsh-mobile='true'] :has(> nav[class*='_nav']) > :not(nav) {
  min-height: 0 !important;
}
/* The panel title duplicates the tab strip; the sheet does not need both,
   and dropping it buys the transcript-height rows below it. */
html[data-dsh-mobile='true'] nav[class*='_nav'] > [class*='_navTitle'] {
  display: none !important;
}
/* Nav cells become a horizontal, scrollable tab strip. */
html[data-dsh-mobile='true'] nav[class*='_nav'] > :has(> [class*='_navCell']) {
  flex-direction: row !important;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  padding: 8px 10px !important;
  gap: 6px;
  -webkit-overflow-scrolling: touch;
  -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
  mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 20px), transparent 100%);
}
html[data-dsh-mobile='true'] nav[class*='_nav'] > :has(> [class*='_navCell'])::-webkit-scrollbar {
  display: none;
}
html[data-dsh-mobile='true'] [class*='_navCell'] {
  flex: 0 0 auto !important;
  width: auto !important;
  min-width: 0 !important;
  min-height: 40px;
  border-radius: 10px;
}
html[data-dsh-mobile='true'] [class*='_navCell'] * {
  white-space: nowrap;
}
/* Settings rows: reclaim the 48px reserved for hover controls. */
html[data-dsh-mobile='true'] [class*='_row'] > [class*='_rowText'] {
  padding-right: 0;
}
/* The appearance cubes are a flex row of three; stacked full-width they become
   proper touch targets instead of three narrow columns. */
html[data-dsh-mobile='true'] [class*='_options'] {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

/* ---------------------------------------------------------------------
   11. Scrolling containers.
   scrollbar-gutter: stable reserves 8px of a 360px column for a thumb
   that mobile never shows.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] :is([class*='_scrollBody'], [class*='_list'], [class*='_paneBody']) {
  scrollbar-gutter: auto;
  overscroll-behavior-y: contain;
}
html[data-dsh-mobile='true'] :is([class*='_tabStrip'], [class*='_stripTabs'], [class*='_crumbTrail']) {
  scrollbar-width: none;
}

/* ---------------------------------------------------------------------
   12. File explorer icons — Material Icon Theme.
   The theme's SVGs are full-colour, so they are painted as a background on the
   icon element the explorer already renders, and the app's own monochrome
   glyph inside it is hidden. The element is kept rather than replaced: it
   belongs to React, and removing or re-parenting a node React owns breaks its
   reconciliation. Only a background is written, which React does not manage.

   Not scoped to the mobile breakpoint: the icon set is a property of the file
   tree, not of the phone layout, and the explorer looks the same on desktop.
   --------------------------------------------------------------------- */
[data-dsh-mi] {
  background-repeat: no-repeat;
  background-position: center;
  background-size: 16px 16px;
}
[data-dsh-mi] > * {
  display: none !important;
}

/* ---------------------------------------------------------------------
   13. Decluttering.
   A phone screen has no room for chrome that only a desktop needs, and
   three groups of controls earn nothing there:

   - the header's open-in-app split button (Finder/Terminal) and the "more
     actions" menu, whose only entry downloads the session log;
   - the composer's tool row — commands, attachments, access mode, model and
     context meter — leaving a text field and a Send button, the shape a chat
     app has on a phone;
   - the per-turn statistics strip under the composer.

   The composer's hidden controls stay reachable behind a small toggle, which
   is what "collapsed by default" means; the rest are simply gone.
   --------------------------------------------------------------------- */
html[data-dsh-mobile='true'] [data-dsh-part='chatHeader'] :is([class*='_split'], [class*='_moreButton']) {
  display: none !important;
}

/* The per-turn statistics strip the app publishes under the composer. */
html[data-dsh-mobile='true'] [data-composer-stats] {
  display: none !important;
}

html[data-dsh-mobile='true'][data-dsh-composer='simple'] [data-composer-seat] [class*='_tools'] {
  display: none !important;
}
html[data-dsh-mobile='true'][data-dsh-composer='simple'] [data-composer-seat] [class*='_trailing'] > :not([class*='_primary']) {
  display: none !important;
}
/* Collapsed, the row only has to seat two controls. */
html[data-dsh-mobile='true'][data-dsh-composer='simple'] [data-composer-seat] [class*='_row'] {
  align-items: center;
  padding-top: 0 !important;
  padding-bottom: 4px !important;
}

/* The reveal toggle. Appended to the row — never prepended — so React's child
   ordering is left alone, then moved to the left with flex order. */
[data-dsh-composer-toggle] {
  order: -1;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-left: 2px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, currentColor);
  cursor: pointer;
  transition:
    background-color var(--dshm-fast) var(--dshm-ease),
    color var(--dshm-fast) var(--dshm-ease);
}
[data-dsh-composer-toggle]:active {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
}
[data-dsh-composer-toggle] svg {
  display: block;
  width: 16px;
  height: 16px;
  transition: transform var(--dshm-fast) var(--dshm-ease);
}
html[data-dsh-composer='full'] [data-dsh-composer-toggle] svg {
  transform: rotate(180deg);
}
`;

    /**
     * Paint Material Icon Theme icons over the file explorer's rows.
     *
     * The explorer already publishes everything needed to pick an icon, so no
     * filename parsing and no mapping tables are needed here:
     *
     *   li[data-files-entry="file"|"directory"]   entry kind
     *   li[data-files-path]                       full path -> basename
     *   button[aria-expanded]                     open folders
     *
     * The host resolves the basename and answers at `/material-icons/<name>`,
     * which the browser caches forever — one request per distinct icon, ever,
     * and none at all for the mapping tables.
     *
     * An icon is painted only **after it loads**, and the app's own glyph is
     * hidden by nothing but the same attribute that paints. The route belongs
     * to the host half, which does not hot-reload, so between a client update
     * and a host restart every request 404s — falling back to the shipped icons
     * beats blanking the tree.
     *
     * @returns the apply function, called on every sync pass.
     */
    function installFileIcons() {
      /** url -> whether it loaded, so a URL is only ever probed once. */
      const probed = new Map();

      /**
       * Basename of a path, handling both separators and trailing slashes.
       * @param path - the entry's `data-files-path`.
       * @returns the last path segment.
       */
      const basename = (path) => {
        const trimmed = path.replace(/[/\\]+$/, '');
        const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
        return cut === -1 ? trimmed : trimmed.slice(cut + 1);
      };

      /**
       * Resolve once whether an icon URL is servable.
       * @param url - icon URL.
       * @returns a promise for whether the image loaded.
       */
      const canLoad = (url) => {
        let pending = probed.get(url);
        if (pending === undefined) {
          pending = new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () => resolve(true);
            probe.onerror = () => resolve(false);
            probe.src = url;
          });
          probed.set(url, pending);
        }
        return pending;
      };

      return () => {
        for (const item of document.querySelectorAll('[data-files-entry]')) {
          const kind = item.getAttribute('data-files-entry');
          if (kind !== 'file' && kind !== 'directory') continue;
          const icon = item.querySelector('svg');
          if (icon === null) continue;

          const name = basename(item.getAttribute('data-files-path') ?? '');
          if (name === '') continue;
          const isDirectory = kind === 'directory';
          const expanded = item.querySelector('button[aria-expanded="true"]') !== null;
          // Folders swap icon on expand/collapse, so the key carries that state:
          // a change in it must repaint even though the name is the same.
          const key = `${name}\u0000${isDirectory ? 1 : 0}\u0000${expanded ? 1 : 0}`;
          if (icon.dataset.dshMiKey === key) continue;
          // Claim the row before the async probe, so a burst of mutations does
          // not queue the same work twice.
          icon.dataset.dshMiKey = key;

          const url =
            `${ICON_ROUTE}/${encodeURIComponent(name)}` +
            `${isDirectory ? `?d=1&o=${expanded ? 1 : 0}` : ''}`;
          canLoad(url).then((ok) => {
            if (icon.dataset.dshMiKey !== key) return;
            if (!ok) {
              // Route absent (host not restarted) or icon missing: keep the
              // app's own glyph and stop retrying this exact key.
              icon.dataset.dshMiKey = `${key}\u0000unavailable`;
              return;
            }
            icon.style.backgroundImage = `url("${url}")`;
            icon.setAttribute('data-dsh-mi', key);
          });
        }
      };
    }

    // =====================================================================
    // Runtime
    // =====================================================================

    /** `<html>` — every layout rule keys off the attributes set here. */
    const root = () => document.documentElement;

    /**
     * Write an attribute only when it actually differs.
     *
     * `setAttribute` fires a MutationObserver record even when the value is
     * unchanged, so an unconditional write inside a mutation-driven sync is a
     * self-feeding loop, and in the worst case a visible repaint loop. Every
     * attribute this plugin writes goes through here.
     * @param el - element to write to.
     * @param name - attribute name.
     * @param value - value to set.
     */
    function setAttr(el, name, value) {
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }

    /**
     * Set or clear a boolean attribute, writing only on a real change.
     * @param el - element to write to.
     * @param name - attribute name.
     * @param on - whether the attribute should be present.
     */
    function toggleAttr(el, name, on) {
      if (on) setAttr(el, name, 'true');
      else if (el.hasAttribute(name)) el.removeAttribute(name);
    }

    /**
     * Resolve an element by a structural hook and tag it, so the stylesheet can
     * target a stable name instead of a per-build CSS-module hash.
     * @param selector - structural query.
     * @param part - value for `data-dsh-part`.
     * @param scope - element to search from.
     * @returns the tagged element, or null when the app has not rendered it.
     */
    function tag(selector, part, scope = document) {
      const el = scope.querySelector(selector);
      if (el !== null) setAttr(el, 'data-dsh-part', part);
      return el;
    }

    /**
     * Re-tag the shell. React can replace any of these nodes on a route or
     * layout change, so this runs on every observed mutation rather than once.
     * @returns the frame element, or null before the shell mounts.
     */
    function tagShell() {
      const frame = tag('#root [class*="_frame"]', 'frame');
      if (frame === null) return null;
      tag('[class*="_sidebarCol"]', 'sidebarCol', frame);
      tag('[class*="_sidebarCol"] > div > div', 'sidebarRoot', frame);
      tag('[class*="_centerCol"]', 'centerCol', frame);
      tag('[data-rightbar-col]', 'rightbarCol', frame);
      tag('[class*="_centerCol"] header', 'chatHeader', frame);
      return frame;
    }

    /** The app's own sidebar toggle, whichever state it is in. */
    const findToggle = () =>
      document.querySelector('button[aria-label="打开侧边栏"], button[aria-label="收起侧边栏"]');

    /**
     * Create the fixed navigation button that replaces the hidden rail.
     * @returns the button.
     */
    function createNavButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-dsh-part', 'nav');
      button.setAttribute('aria-label', '打开侧边栏');
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      return button;
    }

    /**
     * Create the drawer scrim. Kept in the DOM permanently so the open class can
     * animate it; it is `pointer-events: none` and transparent on desktop.
     * @returns the scrim element.
     */
    function createBackdrop() {
      const backdrop = document.createElement('div');
      backdrop.setAttribute('data-dsh-part', 'backdrop');
      backdrop.setAttribute('aria-hidden', 'true');
      return backdrop;
    }

    /**
     * The drawer controller.
     *
     * The app owns "is the sidebar expanded" as `narrowExpanded`, surfaced as the
     * presence or absence of `data-sidebar-collapsed` on the frame. The plugin
     * owns the visual drawer and drives the app's toggle to keep the two in step.
     *
     * Closing is deliberately two-phase: the drawer slides out first and the
     * toggle is only clicked once it is off-screen, because clicking immediately
     * makes the app swap the wide sidebar for the 56px rail *inside* the still
     * visible drawer — an icon rail sliding out where a session list used to be.
     *
     * @param deps - accessors owned by `apply`.
     * @returns the controller surface.
     */
    function createDrawer({ getFrame, getNav }) {
      /** Monotonic token: any state change invalidates a pending open/close. */
      let generation = 0;
      let closeTimer = 0;
      /** Whether the initial "collapse it if the app booted expanded" ran. */
      let settled = false;

      const isMobile = () => root().getAttribute('data-dsh-mobile') === 'true';
      const appExpanded = () => {
        const frame = getFrame();
        return frame !== null && !frame.hasAttribute('data-sidebar-collapsed');
      };
      const setDrawer = (open) => {
        setAttr(root(), 'data-dsh-drawer', open ? 'open' : 'closed');
        const nav = getNav();
        if (nav !== null) setAttr(nav, 'aria-label', open ? '关闭侧边栏' : '打开侧边栏');
      };

      const clickToggle = () => {
        const toggle = findToggle();
        if (toggle !== null) toggle.click();
      };

      /** Slide the drawer in. The app must already render the wide sidebar. */
      const open = () => {
        if (!isMobile()) return;
        window.clearTimeout(closeTimer);
        const token = ++generation;
        if (!appExpanded()) clickToggle();
        // Let React commit the wide sidebar (still off-screen) before sliding.
        requestAnimationFrame(() => {
          if (token !== generation) return;
          setDrawer(true);
        });
      };

      /** Slide the drawer out, then restore the app's collapsed state. */
      const close = () => {
        const token = ++generation;
        setDrawer(false);
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => {
          if (token !== generation) return;
          if (appExpanded()) clickToggle();
        }, DRAWER_MS);
      };

      const toggle = () => {
        if (root().getAttribute('data-dsh-drawer') === 'open') close();
        else open();
      };

      /**
       * Reconcile the drawer attribute with the app's state. Runs on every frame
       * attribute change and on every viewport change.
       */
      const sync = () => {
        if (!isMobile()) {
          // Hand the layout back to the app: no plugin attributes, no drawer.
          if (root().hasAttribute('data-dsh-drawer')) root().removeAttribute('data-dsh-drawer');
          return;
        }
        // First pass on a phone: if the profile's saved preference is "expanded",
        // the app boots with the sidebar open. Close it so the first paint shows
        // the conversation, not a drawer covering it.
        if (!settled) {
          settled = true;
          if (appExpanded()) {
            setDrawer(false);
            const token = ++generation;
            window.setTimeout(() => {
              if (token === generation && appExpanded()) clickToggle();
            }, 0);
            return;
          }
        }
        if (root().getAttribute('data-dsh-drawer') === null) {
          setDrawer(appExpanded());
          return;
        }
        // The app changed its mind without us (a keyboard shortcut, a route
        // change): follow it, but never mid-close, where the app's collapse is
        // our own delayed second phase.
        if (closeTimer !== 0 && root().getAttribute('data-dsh-drawer') === 'closed') return;
        const shouldBeOpen = appExpanded();
        if (shouldBeOpen !== (root().getAttribute('data-dsh-drawer') === 'open')) setDrawer(shouldBeOpen);
      };

      return { open, close, toggle, sync };
    }

    /**
     * Keyboard inset. iOS shrinks only the *visual* viewport, so a fixed-height
     * shell keeps the composer under the keyboard. Publishing the overlap lets
     * the frame shrink by exactly that much.
     *
     * This is the one place the plugin reacts to something other than the app's
     * DOM, and it has to be defensive, because the visual viewport moves for
     * reasons that have nothing to do with a keyboard:
     *
     * - **Baseline, not `innerHeight`.** The URL bar collapsing and expanding
     *   changes `vv.height` by ~50–90px on its own. Measuring against the
     *   largest height ever seen means browser chrome can never be mistaken for
     *   a keyboard.
     * - **Focus guard.** A keyboard is only up while an editable is focused.
     * - **Hysteresis.** Engage at a height no browser bar reaches, release much
     *   lower, so a value hovering near the threshold cannot oscillate.
     * - **No write when unchanged.** Shrinking the frame changes the very
     *   layout the browser measures to decide whether to show its URL bar, so
     *   an unconditional write here is a feedback loop: the frame grows, the
     *   bar expands, the frame shrinks, forever. Writing only on a real change
     *   breaks that loop at the source.
     *
     * @returns the disposer.
     */
    function trackKeyboard() {
      const vv = window.visualViewport;
      if (vv === undefined || vv === null) return () => {};
      /** Whether the keyboard is currently believed to be up. */
      let engaged = false;
      /** Last value written, so an unchanged value writes nothing. */
      let applied = 0;

      const isEditable = (el) =>
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === 'TEXTAREA' ||
          (el.tagName === 'INPUT' && !/^(checkbox|radio|range|file|button|submit|reset|color)$/i.test(el.type)));

      const apply = () => {
        // Measure against the LAYOUT viewport — never against a baseline of the
        // visual viewport's own history. The two differ in exactly the way that
        // matters here:
        //
        //   iOS               keyboard overlays the page; innerHeight unchanged
        //                     -> difference == keyboard   (an inset is owed)
        //   Android           `interactive-widget=resizes-content` lets the
        //   (resizes-content) keyboard shrink the layout viewport too, so the
        //                     page is *already* the right size
        //                     -> difference == 0          (nothing is owed)
        //   Android           keyboard shrinks only the visual viewport
        //   (resizes-visual)  -> difference == keyboard    (an inset is owed)
        //
        // Remembering the tallest visual height instead also reports a keyboard
        // on Android's resizes-content path, where the browser has already
        // shrunk the page: the inset stacks on top of that and the composer is
        // pushed up by twice the keyboard height, which parks it near the top.
        //
        // An iOS URL bar moving changes both numbers together, so the difference
        // stays ~0 with no special case, and `offsetTop` keeps a page that the
        // browser scrolled while focusing from being counted twice.
        const overlap = window.innerHeight - vv.height - vv.offsetTop;
        const hidden = overlap > 0 ? overlap : 0;
        const editing = isEditable(document.activeElement);
        if (engaged) {
          if (!editing || hidden < KEYBOARD_RELEASE) engaged = false;
        } else if (editing && hidden >= KEYBOARD_ENGAGE) {
          engaged = true;
        }
        const inset = engaged ? Math.round(hidden) : 0;
        if (inset === applied) return;
        applied = inset;
        root().style.setProperty('--dshm-kb', `${inset}px`);
        toggleAttr(root(), 'data-dsh-kb', inset > 0);
      };

      // The keyboard follows focus, so focus changes are the reliable edge;
      // the visual viewport only says how tall it is.
      const onFocusChange = () => window.setTimeout(apply, 0);

      vv.addEventListener('resize', apply);
      vv.addEventListener('scroll', apply);
      document.addEventListener('focusin', onFocusChange);
      document.addEventListener('focusout', onFocusChange);
      return () => {
        vv.removeEventListener('resize', apply);
        vv.removeEventListener('scroll', apply);
        document.removeEventListener('focusin', onFocusChange);
        document.removeEventListener('focusout', onFocusChange);
        root().style.removeProperty('--dshm-kb');
        root().removeAttribute('data-dsh-kb');
      };
    }

    /**
     * Edge-swipe gestures: drag in from the left edge to open, drag left to
     * close. Only the horizontal intent is claimed, so vertical scrolling inside
     * the drawer and the transcript is untouched.
     * @param drawer - the drawer controller.
     * @returns the disposer.
     */
    function trackSwipes(drawer) {
      let startX = 0;
      let startY = 0;
      let tracking = false;
      let claimed = false;

      const onStart = (event) => {
        if (root().getAttribute('data-dsh-mobile') !== 'true') return;
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        const open = root().getAttribute('data-dsh-drawer') === 'open';
        tracking = open || touch.clientX <= EDGE_ZONE;
        claimed = false;
        startX = touch.clientX;
        startY = touch.clientY;
      };

      const onMove = (event) => {
        if (!tracking || claimed || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) > Math.abs(dx)) {
          tracking = false;
          return;
        }
        const open = root().getAttribute('data-dsh-drawer') === 'open';
        if (!open && dx >= SWIPE_MIN) {
          claimed = true;
          drawer.open();
        } else if (open && dx <= -SWIPE_MIN) {
          claimed = true;
          drawer.close();
        }
      };

      const onEnd = () => {
        tracking = false;
        claimed = false;
      };

      const options = { passive: true };
      document.addEventListener('touchstart', onStart, options);
      document.addEventListener('touchmove', onMove, options);
      document.addEventListener('touchend', onEnd, options);
      document.addEventListener('touchcancel', onEnd, options);
      return () => {
        document.removeEventListener('touchstart', onStart, options);
        document.removeEventListener('touchmove', onMove, options);
        document.removeEventListener('touchend', onEnd, options);
        document.removeEventListener('touchcancel', onEnd, options);
      };
    }

    /**
     * On a phone, plain Enter inserts a newline; the Send button is the only
     * way to submit.
     *
     * A soft keyboard has one Enter key and no Shift, so "Enter sends" turns
     * every attempt to start a second line into a premature send. Desktop keeps
     * Enter-to-send, which is why this is scoped to the mobile layout.
     *
     * The app already implements exactly the wanted gesture: its composer
     * keymap starts with `if (event?.shiftKey === true) return false;`, falling
     * through to Lexical, which inserts a line break. So rather than
     * reimplementing insertion — and having to keep Lexical's state in sync by
     * hand — this swallows the plain Enter in the capture phase and re-dispatches
     * the Shift+Enter the app already handles.
     *
     * Everything that must keep working is left alone:
     *   - **IME.** While composing, Enter commits the candidate; intercepting it
     *     would break every Chinese, Japanese and Korean input method. Guarded by
     *     `isComposing` and the legacy `keyCode === 229`.
     *   - **The `/` and `@` menus.** Enter picks the highlighted entry, which the
     *     app marks with `data-trigger-menu`.
     *   - **Modifier chords.** Cmd/Ctrl+Enter still submits, so an external
     *     keyboard behaves as before.
     *
     * @returns the disposer.
     */
    function newlineOnEnter() {
      const onKeyDown = (event) => {
        if (event.key !== 'Enter') return;
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        if (root().getAttribute('data-dsh-mobile') !== 'true') return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.isContentEditable) return;
        // The trigger menu owns Enter while it is open.
        if (document.querySelector('[data-trigger-menu]') !== null) return;

        event.preventDefault();
        // React delegates keydown at the root container, which is deeper than
        // `document`, so stopping here keeps the app's submit path out of it.
        event.stopPropagation();
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }

    /**
     * Give the composer a collapsed/expanded switch.
     *
     * Collapsed is the phone default: a text field and a Send button, the shape
     * a chat app has. The controls that step out of the way — commands,
     * attachments, access mode, model, context meter — are the ones a desktop
     * needs and a thumb rarely does, so they sit behind a small chevron rather
     * than disappearing for good.
     *
     * The button is **appended** to the row and moved left with flex `order`.
     * React owns that row's children, and inserting a foreign node at the front
     * would shift every index React reconciles against; appending keeps the
     * existing ones in place. The sync pass re-adds it if a re-render drops it.
     *
     * @returns the apply function, called on every sync pass.
     */
    function installComposerToggle() {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.setAttribute('data-dsh-composer-toggle', '');
      toggle.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M4 6l4 4 4-4"/></svg>';

      /** Reflect the current mode on the button itself, for a11y. */
      const paint = () => {
        const expanded = root().getAttribute('data-dsh-composer') === 'full';
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggle.setAttribute('aria-label', expanded ? '收起输入选项' : '展开输入选项');
      };

      toggle.addEventListener('click', () => {
        const expanded = root().getAttribute('data-dsh-composer') === 'full';
        setAttr(root(), 'data-dsh-composer', expanded ? 'simple' : 'full');
        paint();
      });

      return () => {
        // Only the mobile layout collapses; the desktop composer is unchanged.
        if (root().getAttribute('data-dsh-mobile') !== 'true') {
          if (root().hasAttribute('data-dsh-composer')) root().removeAttribute('data-dsh-composer');
          if (toggle.isConnected) toggle.remove();
          return;
        }
        if (!root().hasAttribute('data-dsh-composer')) setAttr(root(), 'data-dsh-composer', 'simple');
        const row = document.querySelector('[data-composer-seat] [class*="_row"]');
        if (row === null) {
          if (toggle.isConnected) toggle.remove();
          return;
        }
        if (toggle.parentElement !== row) row.append(toggle);
        paint();
      };
    }

    /**
     * Ensure `viewport-fit=cover` and the keyboard-resize hint are on the
     * viewport meta. Without `cover` every `env(safe-area-inset-*)` is zero and
     * the notch and home indicator paint over the UI.
     * @returns the disposer.
     */
    function patchViewportMeta() {
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta === null) return () => {};
      const original = meta.getAttribute('content') ?? '';
      if (original.includes('viewport-fit')) return () => {};
      meta.setAttribute(
        'content',
        `${original.replace(/,\s*$/, '')}, viewport-fit=cover, interactive-widget=resizes-content`,
      );
      return () => {
        meta.setAttribute('content', original);
      };
    }

    /**
     * Plugin body.
     * @param ctx - client Cordis context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const tagEl = document.createElement('style');
        tagEl.dataset.plugin = PLUGIN_ID;
        tagEl.dataset.pluginCss = `${PLUGIN_ID}/mobile.css`;
        tagEl.textContent = CSS;
        document.head.appendChild(tagEl);
        return () => {
          tagEl.remove();
        };
      }, 'mobile-ui: stylesheet');

      ctx.effect(() => {
        const disposers = [];
        let frame = null;
        let nav = null;
        let backdrop = null;

        root().setAttribute('data-dsh-mobile', 'false');

        const drawer = createDrawer({
          getFrame: () => frame,
          getNav: () => nav,
        });

        nav = createNavButton();
        backdrop = createBackdrop();
        nav.addEventListener('click', () => {
          drawer.toggle();
        });
        backdrop.addEventListener('click', () => {
          drawer.close();
        });
        document.body.append(backdrop, nav);

        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          if (root().getAttribute('data-dsh-drawer') === 'open') drawer.close();
        };
        document.addEventListener('keydown', onKeyDown);

        /**
         * Close the drawer after a deliberate selection inside it. Folder rows
         * only expand, so they are excluded.
         */
        const onDrawerClick = (event) => {
          if (root().getAttribute('data-dsh-drawer') !== 'open') return;
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest('button[aria-label="收起侧边栏"], button[aria-label="打开侧边栏"]') !== null) return;
          const picked =
            target.closest('[class*="_sessionRow"]') !== null ||
            target.closest('button[aria-label="新建会话"]') !== null ||
            target.closest('[class*="_newSession"]') !== null ||
            target.closest('[class*="_searchResultRow"]') !== null ||
            // Settings opens a full-viewport dialog that escapes this drawer;
            // leaving the drawer open behind it just wastes a slide-out later.
            target.closest('button[aria-label="设置"]') !== null;
          if (picked) window.setTimeout(() => drawer.close(), 60);
        };

      /**
       * Mirror the right panel's visibility onto the root. Its `data-*` markers
       * describe the panel *mode* and stay put while it is hidden, so the only
       * trustworthy signals are the computed visibility and the panel actually
       * being on screen — a closed panel sits translated a full width to the
       * right, still `visible` during the slide-out.
       */
      const syncRightPanel = () => {
        const panel = document.querySelector('[data-sidebar-right-panel]');
        if (panel === null) {
          setAttr(root(), 'data-dsh-rightpanel', 'closed');
          return;
        }
        const rect = panel.getBoundingClientRect();
        const open =
          getComputedStyle(panel).visibility === 'visible' &&
          rect.width > 0 &&
          rect.left < window.innerWidth - 4;
        setAttr(root(), 'data-dsh-rightpanel', open ? 'open' : 'closed');
      };

      /**
       * Flag whether a viewport-level surface is open inside the sidebar.
       *
       * The settings dialog (and the directory picker) mount inside the sidebar
       * subtree. Their `position: fixed` escapes the parked drawer's box, but
       * `pointer-events: none` is inherited rather than escaped — so without
       * this flag the dialog renders on top of everything and is completely
       * inert: no taps, no scrolling, and every hit lands on the conversation
       * underneath. Candidates are filtered by class and confirmed by geometry,
       * so a false positive cannot leave the drawer interactive.
       */
      const syncModal = () => {
        const sidebar = document.querySelector('[data-dsh-part="sidebarCol"]');
        let modal = false;
        if (sidebar !== null) {
          for (const el of sidebar.querySelectorAll(
            '[class*="_overlay"], [class*="_mask"], [class*="_dialog"], [class*="_confirmation"]',
          )) {
            const style = getComputedStyle(el);
            if (style.position !== 'fixed' || style.visibility === 'hidden' || style.display === 'none') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.5) {
              modal = true;
              break;
            }
          }
        }
        setAttr(root(), 'data-dsh-modal', modal ? 'true' : 'false');
      };

      // The app mutates class and style attributes constantly (hover states,
      // measured widths), so the observer coalesces into one pass per frame.
      //
      // One extra pass runs after the animation settles. The right panel
      // writes its final transform once, when the slide *starts*, and then
      // emits no further attributes — so a single sample taken a frame later
      // catches it mid-flight and latches the wrong state for good. The
      // settle pass is deliberately not re-armed, so this cannot become a poll.
      let scheduled = false;
      let settleTimer = 0;
      const applyFileIcons = installFileIcons();
      const applyComposerToggle = installComposerToggle();

      const runSync = () => {
        frame = tagShell();
        applyFileIcons();
        applyComposerToggle();
        if (frame !== null && frame.dataset.dshObserved !== 'true') {
          frame.dataset.dshObserved = 'true';
          frame.addEventListener('click', onDrawerClick);
        }
        syncRightPanel();
        syncModal();
        drawer.sync();
      };
      const sync = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          runSync();
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(() => {
            runSync();
          }, SETTLE_MS);
        });
      };

      const observer = new MutationObserver(sync);

        const media = window.matchMedia(MOBILE_QUERY);
        const onMedia = () => {
          setAttr(root(), 'data-dsh-mobile', media.matches ? 'true' : 'false');
          drawer.sync();
        };
        media.addEventListener('change', onMedia);

        frame = tagShell();
        onMedia();
        syncRightPanel();
        syncModal();
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-sidebar-collapsed', 'class', 'style', 'data-sidebar-right-panel'],
        });

        disposers.push(trackKeyboard(), trackSwipes(drawer), patchViewportMeta(), newlineOnEnter());

        return () => {
          window.clearTimeout(settleTimer);
          observer.disconnect();
          media.removeEventListener('change', onMedia);
          document.removeEventListener('keydown', onKeyDown);
          frame?.removeEventListener('click', onDrawerClick);
          for (const dispose of disposers) dispose();
          nav?.remove();
          backdrop?.remove();
          root().removeAttribute('data-dsh-mobile');
          root().removeAttribute('data-dsh-drawer');
          root().removeAttribute('data-dsh-rightpanel');
          root().removeAttribute('data-dsh-modal');
        };
      }, 'mobile-ui: runtime');
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});
