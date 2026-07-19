import { useEffect } from "react";
import { useRouter } from "./router";

const FLASH_OUTLINE = "2px solid #f59e0b";
const FLASH_MS = 1600;
const MAX_ATTEMPTS = 30;
const RETRY_MS = 100;

// Finds the DOM node for a dot-path field ("brand.name",
// "intro.stats.0.label"), stamped as data-field-path by
// form/fields/object/ui.tsx and app/entry-form.tsx's content-pane wrapper.
// Array items don't push their index onto that path (see PathContext /
// AddToPathProvider call sites), so a path reaching into an array item has
// no exact match - this falls back to the nearest ancestor that does
// (dropping trailing segments), landing on the array's own field instead.
function findFieldElement(path: string): HTMLElement | null {
  const segments = path.split(".");
  for (let i = segments.length; i > 0; i--) {
    const el = document.querySelector<HTMLElement>(
      `[data-field-path="${CSS.escape(segments.slice(0, i).join("."))}"]`,
    );
    if (el) return el;
  }
  return null;
}

// Deep-links from the VEI "ref" hover menu (packages/astro/src/editor/
// Toolbar.tsx's goToAdmin) into a specific field on this entry's admin
// edit page, via a `?field=<dot.path>` query param. Called once per
// SingletonPage/ItemPage mount. The target field's wrapper usually isn't
// mounted yet on the very first render (entry data loads async), so this
// polls briefly rather than assuming it's already there.
export function useScrollToFieldParam() {
  const router = useRouter();
  useEffect(() => {
    const field = new URLSearchParams(router.search).get("field");
    if (!field) return;
    let attempts = 0;
    let cancelled = false;
    const tryScroll = () => {
      if (cancelled) return;
      attempts += 1;
      const el = findFieldElement(field);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const prevOutline = el.style.outline;
        const prevOffset = el.style.outlineOffset;
        el.style.outline = FLASH_OUTLINE;
        el.style.outlineOffset = "2px";
        setTimeout(() => {
          el.style.outline = prevOutline;
          el.style.outlineOffset = prevOffset;
        }, FLASH_MS);
        return;
      }
      if (attempts < MAX_ATTEMPTS) setTimeout(tryScroll, RETRY_MS);
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
    // Only the field param should re-trigger this - re-running on every
    // router.search change (e.g. an unrelated ?branch= navigation) would
    // undo the user's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.search]);
}
