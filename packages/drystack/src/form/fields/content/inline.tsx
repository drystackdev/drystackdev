import { useEffect, useId, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorState } from 'prosemirror-state';
import { KeystarProvider, useProvider } from '@keystar/ui/core';
import {
  SCHEME_AUTO,
  SCHEME_DARK,
  SCHEME_LIGHT,
  THEME_DEFAULT,
} from '@keystar/ui/primitives';

import { Toolbar } from '../markdoc/editor/Toolbar';
import { prosemirrorStyles } from '../markdoc/editor/utils';
import { EditorPopoverDecoration } from '../markdoc/editor/popovers';
import { ProseMirrorEditor } from '../markdoc/editor/editor-view';
import { AutocompleteDecoration } from '../markdoc/editor/autocomplete/decoration';
import { NodeViews } from '../markdoc/editor/react-node-views';
import { MediaScopeProvider } from '../markdoc/editor/media-scope';
import { EditorContextProvider, getToolbarId } from '../markdoc/editor/context';

// Distance between the edited element and the floating toolbar above it.
const TOOLBAR_GAP = 8;

// This toolbar portals to <body>, so packages/astro's editor.css catches its
// KeystarProvider wrapper with `body > .kui-scheme--*` — a rule written for
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
// `position` because z-index is inert on a static box — `isolation` alone
// opens a stacking context but doesn't make z-index apply.
const TOOLBAR_Z_INDEX = 999998;

const schemeClasses = {
  auto: SCHEME_AUTO,
  light: SCHEME_LIGHT,
  dark: SCHEME_DARK,
};

// The classes that define Keystar's design tokens (`--kui-*`) on whatever
// element carries them.
//
// Everything else in this file renders under a <KeystarProvider>, which puts
// these on a wrapper div of its own — but the mount node doesn't: it's the
// live page's own element, outside the editor's React tree entirely. So every
// `--kui-*` the editor's DOM references there (prosemirrorStyles' gap
// cursor/selection ring/placeholder, the blockquote and table node specs'
// borders, the image node view's chrome) resolves to nothing, and those
// affordances render colourless.
//
// Not `documentElementClasses()` from @keystar/ui/core, which is the obvious
// candidate: it bundles these together with a reset whose `html& body`
// selector sets the page background. That's inert on a <div> but would wreck
// the live site if this ever moved to <html> — so take only the two token
// classes, which carry nothing but custom properties (plus `color-scheme`).
function tokenClassesFor(colorScheme: 'auto' | 'light' | 'dark' | undefined) {
  return [THEME_DEFAULT, schemeClasses[colorScheme ?? 'auto']];
}

/**
 * The real formatting toolbar, floated next to `anchor` rather than sitting
 * in a container above the editable area — an inline editor has no container
 * of its own to put it in (see InlineDocumentEditor).
 *
 * The toolbar only reaches the editor through React context (never DOM
 * adjacency), so portaling it away from the editable node costs nothing
 * functionally. It does cost the Keystar theme: <KeystarProvider> applies its
 * design tokens/colorScheme via a class on a wrapper div, and a portal escapes
 * that div physically even though context still flows through it. Re-wrapping
 * at the portal site is how @keystar/ui's own Overlay (behind Dialog/Popover)
 * solves the same problem — any future code portaling a Keystar component to
 * <body> needs this too.
 *
 * The re-wrap passes no colorScheme/locale on purpose: KeystarProvider reads
 * both from the parent provider's context, which a portal doesn't break, so
 * inheriting keeps this in sync with the admin's theme for free. UNSAFE_style
 * isn't cosmetic — KeystarProvider skips rendering the class-carrying div
 * altogether unless something forces it, and a prop like this is what forces
 * it (see its "Only wrap in DOM node when necessary" check).
 */
function FloatingToolbar({ anchor, id }: { anchor: HTMLElement; id: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const update = () => setRect(anchor.getBoundingClientRect());
    update();
    // `true` — a scroll inside any ancestor moves the anchor too, and those
    // events don't bubble.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [anchor]);

  if (!rect) return null;

  return createPortal(
    <KeystarProvider
      UNSAFE_style={{
        isolation: 'isolate',
        position: 'relative',
        zIndex: TOOLBAR_Z_INDEX,
      }}
    >
      <div
        data-drystack-inline-toolbar=""
        style={{
          position: 'fixed',
          top: rect.top - TOOLBAR_GAP,
          left: rect.left,
          transform: 'translateY(-100%)',
          zIndex: 100,
        }}
      >
        <Toolbar id={getToolbarId(id)} data-drystack-editor="toolbar" />
      </div>
    </KeystarProvider>,
    document.body
  );
}

/**
 * A `fields.content` editor that edits an element already on the page instead
 * of rendering an editable area of its own — the visual editor mounts one per
 * content spot on the live site (packages/astro/src/editor/InlineContentEditors.tsx).
 *
 * Deliberately omits the admin editor's `contentStyles`/`useProseStyleProps`
 * (see ../markdoc/editor/index.tsx): the whole point is that the page's own
 * typography and spacing keep applying while editing, so what you edit looks
 * exactly like what visitors see. `prosemirrorStyles` is a different,
 * non-typographic stylesheet — it only styles ProseMirror's own interaction
 * affordances (gap cursor, node-selection ring, placeholder), which have no
 * built-in appearance and which no site stylesheet would ever style — so it
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
    return () => {
      mount.classList.remove(...classes);
    };
  }, [mount, colorScheme]);

  const mediaScope = useMemo(
    () =>
      entryDirectory
        ? { directory: `${entryDirectory}/assets`, label: 'This entry' }
        : null,
    [entryDirectory]
  );

  return (
    <MediaScopeProvider value={mediaScope}>
      <EditorContextProvider value={editorContext}>
        <ProseMirrorEditor value={value} onChange={onChange} mount={mount}>
          <FloatingToolbar anchor={mount} id={id} />
          <NodeViews state={value} />
          <EditorPopoverDecoration state={value} />
          <AutocompleteDecoration />
        </ProseMirrorEditor>
      </EditorContextProvider>
    </MediaScopeProvider>
  );
}
