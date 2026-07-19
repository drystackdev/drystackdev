import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { EditorState } from "prosemirror-state";
import { KeystarProvider, useProvider } from "@keystar/ui/core";
import {
  SCHEME_AUTO,
  SCHEME_DARK,
  SCHEME_LIGHT,
  THEME_DEFAULT,
} from "@keystar/ui/primitives";

import { Toolbar } from "../markdoc/editor/Toolbar";
import { prosemirrorStyles } from "../markdoc/editor/utils";
import { EditorPopoverDecoration } from "../markdoc/editor/popovers";
import { ProseMirrorEditor } from "../markdoc/editor/editor-view";
import { AutocompleteDecoration } from "../markdoc/editor/autocomplete/decoration";
import { NodeViews } from "../markdoc/editor/react-node-views";
import { MediaScopeProvider } from "../markdoc/editor/media-scope";
import { EditorContextProvider, getToolbarId } from "../markdoc/editor/context";

// Distance between the edited element and the floating toolbar above it.
const TOOLBAR_GAP = 8;

// Floor for the toolbar's distance from the viewport's top edge. Without
// this, editing a content block taller than the viewport (so its top edge
// scrolls above screen) pushes the toolbar - floated just above that top
// edge - off-screen too, with nothing left to click to format the selection.
const VIEWPORT_TOP_OFFSET = 30;

// Gap kept between the toolbar's right edge and the viewport's right edge.
const VIEWPORT_SIDE_MARGIN = 8;

// This toolbar portals to <body>, so packages/astro's editor.css catches its
// KeystarProvider wrapper with `body > .kui-scheme--*` - a rule written for
// Keystar's own portalled overlays (dialogs, tooltips) that lifts them to
// z-index 2147483001. That's above `#drystack-editor-root` (999999), which is
// where the node popovers live: image/grid/table render with `portal={false}`,
// so they never leave that stacking context and can't be lifted past the
// toolbar by a z-index of their own (popovers/index.tsx's `zIndex: 2` for
// images only orders siblings *inside* the root). The toolbar would then paint
// over them and swallow their clicks.
//
// Sitting just under the editor root lets the popovers win while still
// clearing the host page's own positioned sections (z-index 1..60). Set inline
// so it beats the stylesheet rule without an `!important`, and paired with
// `position` because z-index is inert on a static box - `isolation` alone
// opens a stacking context but doesn't make z-index apply.
const TOOLBAR_Z_INDEX = 999998;

const schemeClasses = {
  auto: SCHEME_AUTO,
  light: SCHEME_LIGHT,
  dark: SCHEME_DARK,
};

// Marks each mount node this file has adopted. Only needed to tell one content
// spot from another - see isEditorChrome.
const MOUNT_ATTR = "data-drystack-inline-content";

/**
 * Whether `el` belongs to the editor's own UI rather than the live page: this
 * toolbar, the menus/dialogs/tooltips its buttons portal to <body>, and the
 * node popovers under the visual editor's root. Every one of them renders under
 * a <KeystarProvider>, whose wrapper div always carries THEME_DEFAULT, and
 * nothing on the host page ever does.
 *
 * The exception is the mount nodes, which get THEME_DEFAULT of their own (see
 * tokenClassesFor) despite being page elements - so they're excluded, which is
 * also what lets clicking into one content spot dismiss another's toolbar.
 */
function isEditorChrome(el: Element) {
  return !!el.closest(`.${THEME_DEFAULT}`) && !el.closest(`[${MOUNT_ATTR}]`);
}

/**
 * Whether `mount`'s toolbar should be on screen: false until the user starts
 * working in that editor, true until they move on.
 *
 * An inline editor mounts for every content spot the moment edit mode turns on,
 * so an unconditional toolbar means every spot on the page floats one over
 * whatever content sits above it, before the user has asked for any of them.
 *
 * Deliberately not the editor's focus state: react-aria focuses a button when
 * it's pressed, so a toolbar tied to `view.hasFocus()` would unmount itself out
 * from under the very click it's there to receive. This tracks where
 * interaction *lands* instead - inside this mount shows the toolbar, editor
 * chrome (including the overlays a press opens) leaves it alone, anywhere else
 * hides it.
 */
function useToolbarVisible(mount: HTMLElement) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = (event: Event) => {
      const el = event.target instanceof Element ? event.target : null;
      if (el && mount.contains(el)) {
        setVisible(true);
      } else if (!el || !isEditorChrome(el)) {
        setVisible(false);
      }
    };
    // Both events, because either can happen without the other: clicking the
    // page's own (unfocusable) text fires no focusin anywhere, and tabbing away
    // fires no pointerdown. Capture, so a host page that stops propagation on
    // either one can't strand the toolbar on screen.
    document.addEventListener("focusin", update, true);
    document.addEventListener("pointerdown", update, true);
    return () => {
      document.removeEventListener("focusin", update, true);
      document.removeEventListener("pointerdown", update, true);
    };
  }, [mount]);
  return visible;
}

// The classes that define Keystar's design tokens (`--kui-*`) on whatever
// element carries them.
//
// Everything else in this file renders under a <KeystarProvider>, which puts
// these on a wrapper div of its own - but the mount node doesn't: it's the
// live page's own element, outside the editor's React tree entirely. So every
// `--kui-*` the editor's DOM references there (prosemirrorStyles' gap
// cursor/selection ring/placeholder, the blockquote and table node specs'
// borders, the image node view's chrome) resolves to nothing, and those
// affordances render colourless.
//
// Not `documentElementClasses()` from @keystar/ui/core, which is the obvious
// candidate: it bundles these together with a reset whose `html& body`
// selector sets the page background. That's inert on a <div> but would wreck
// the live site if this ever moved to <html> - so take only the two token
// classes, which carry nothing but custom properties (plus `color-scheme`).
function tokenClassesFor(colorScheme: "auto" | "light" | "dark" | undefined) {
  return [THEME_DEFAULT, schemeClasses[colorScheme ?? "auto"]];
}

/**
 * The real formatting toolbar, floated next to `anchor` rather than sitting
 * in a container above the editable area - an inline editor has no container
 * of its own to put it in (see InlineDocumentEditor).
 *
 * The toolbar only reaches the editor through React context (never DOM
 * adjacency), so portaling it away from the editable node costs nothing
 * functionally. It does cost the Keystar theme: <KeystarProvider> applies its
 * design tokens/colorScheme via a class on a wrapper div, and a portal escapes
 * that div physically even though context still flows through it. Re-wrapping
 * at the portal site is how @keystar/ui's own Overlay (behind Dialog/Popover)
 * solves the same problem - any future code portaling a Keystar component to
 * <body> needs this too.
 *
 * The re-wrap passes no colorScheme/locale on purpose: KeystarProvider reads
 * both from the parent provider's context, which a portal doesn't break, so
 * inheriting keeps this in sync with the admin's theme for free. UNSAFE_style
 * isn't cosmetic - KeystarProvider skips rendering the class-carrying div
 * altogether unless something forces it, and a prop like this is what forces
 * it (see its "Only wrap in DOM node when necessary" check).
 */
function FloatingToolbar({ anchor, id }: { anchor: HTMLElement; id: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Measured rather than assumed, since the toolbar's own height (which
  // varies with the schema's enabled buttons - see Toolbar's Separator/
  // config.inlineOnly branching) is what `top` needs to place its *bottom*
  // edge `TOOLBAR_GAP` above the anchor.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useLayoutEffect(() => {
    const update = () => setRect(anchor.getBoundingClientRect());
    update();
    // `true` - a scroll inside any ancestor moves the anchor too, and those
    // events don't bubble.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [anchor]);

  useLayoutEffect(() => {
    if (toolbarEl) setToolbarHeight(toolbarEl.getBoundingClientRect().height);
  }, [toolbarEl]);

  if (!rect) return null;

  // Natural placement floats the toolbar just above the anchor's top edge.
  // Once scrolling has carried that edge high enough that this would push
  // the toolbar above the viewport - editing inside a content block taller
  // than the viewport scrolls its top edge, and so this anchor, way above
  // screen - pin it just under the viewport's top edge instead, so it's
  // never unreachable mid-edit.
  const top = Math.max(
    VIEWPORT_TOP_OFFSET,
    rect.top - TOOLBAR_GAP - toolbarHeight,
  );
  // Left-anchored with no `width`/`right` of its own, this box otherwise
  // sizes to fit every button (shrink-to-fit, same as a floated element) -
  // on a narrow (mobile) viewport that's wider than the screen, and with no
  // ancestor clipping it, it simply overflows past the right edge with no
  // way to reach the buttons that fall off it. Capping `maxWidth` to what's
  // left of the viewport forces ToolbarScrollArea's own `overflowX: auto`
  // (see Toolbar.tsx) to actually kick in and scroll internally instead.
  const maxWidth = `calc(100vw - ${rect.left}px - ${VIEWPORT_SIDE_MARGIN}px)`;

  return createPortal(
    <KeystarProvider
      UNSAFE_style={{
        isolation: "isolate",
        position: "relative",
        zIndex: TOOLBAR_Z_INDEX,
      }}
    >
      <div
        ref={setToolbarEl}
        data-drystack-inline-toolbar=""
        style={{
          position: "fixed",
          top,
          left: rect.left,
          maxWidth,
          zIndex: 100,
        }}
      >
        <Toolbar id={getToolbarId(id)} data-drystack-editor="toolbar" />
      </div>
    </KeystarProvider>,
    document.body,
  );
}

/**
 * A `fields.content` editor that edits an element already on the page instead
 * of rendering an editable area of its own - the visual editor mounts one per
 * content spot on the live site (packages/astro/src/editor/InlineContentEditors.tsx).
 *
 * Deliberately omits the admin editor's `contentStyles`/`useProseStyleProps`
 * (see ../markdoc/editor/index.tsx): the whole point is that the page's own
 * typography and spacing keep applying while editing, so what you edit looks
 * exactly like what visitors see. `prosemirrorStyles` is a different,
 * non-typographic stylesheet - it only styles ProseMirror's own interaction
 * affordances (gap cursor, node-selection ring, placeholder), which have no
 * built-in appearance and which no site stylesheet would ever style - so it
 * gets added to the mount node instead of dropped.
 */
export function InlineDocumentEditor({
  mount,
  value,
  onChange,
  entryDirectory,
}: {
  mount: HTMLElement;
  value: EditorState;
  onChange: (state: EditorState) => void;
  entryDirectory: string | undefined;
}) {
  const id = useId();
  const editorContext = useMemo(() => ({ id }), [id]);
  const { colorScheme } = useProvider();

  useEffect(() => {
    const classes = [prosemirrorStyles, ...tokenClassesFor(colorScheme)];
    mount.classList.add(...classes);
    mount.setAttribute(MOUNT_ATTR, "");
    return () => {
      mount.classList.remove(...classes);
      mount.removeAttribute(MOUNT_ATTR);
    };
  }, [mount, colorScheme]);

  const toolbarVisible = useToolbarVisible(mount);

  const mediaScope = useMemo(
    () =>
      entryDirectory
        ? { directory: `${entryDirectory}/assets`, label: "This entry" }
        : null,
    [entryDirectory],
  );

  return (
    <MediaScopeProvider value={mediaScope}>
      <EditorContextProvider value={editorContext}>
        <ProseMirrorEditor value={value} onChange={onChange} mount={mount}>
          {toolbarVisible && <FloatingToolbar anchor={mount} id={id} />}
          <NodeViews state={value} />
          <EditorPopoverDecoration state={value} />
          <AutocompleteDecoration />
        </ProseMirrorEditor>
      </EditorContextProvider>
    </MediaScopeProvider>
  );
}
