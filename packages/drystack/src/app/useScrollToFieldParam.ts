import { useEffect } from "react";
import { useRouter } from "./router";

const FLASH_OUTLINE = "2px solid #f59e0b";
const FLASH_MS = 1600;
const MAX_ATTEMPTS = 30;
const RETRY_MS = 100;
// Image fields (ImageFieldInput / useMediaLibraryPreviewURL) resolve their
// preview asynchronously and grow from 0 height once the blob URL loads, so
// anything below one - including the target field - can still get pushed
// further down the page well after the first scrollIntoView() fires. Keep
// re-scrolling for a bit after finding the field to correct for that.
const SETTLE_MS = 2000;
const SETTLE_INTERVAL_MS = 200;

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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Stop correcting the scroll position as soon as the user takes over.
    const stopSettling = () => {
      cancelled = true;
    };
    window.addEventListener("wheel", stopSettling, { passive: true });
    window.addEventListener("touchstart", stopSettling, { passive: true });

    const settle = (el: HTMLElement, deadline: number) => {
      if (cancelled) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (Date.now() < deadline) {
        timeoutId = setTimeout(() => settle(el, deadline), SETTLE_INTERVAL_MS);
        return;
      }
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = FLASH_OUTLINE;
      el.style.outlineOffset = "2px";
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.outlineOffset = prevOffset;
      }, FLASH_MS);
    };

    const tryScroll = () => {
      if (cancelled) return;
      attempts += 1;
      const el = findFieldElement(field);
      if (el) {
        settle(el, Date.now() + SETTLE_MS);
        return;
      }
      if (attempts < MAX_ATTEMPTS) timeoutId = setTimeout(tryScroll, RETRY_MS);
    };
    tryScroll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      window.removeEventListener("wheel", stopSettling);
      window.removeEventListener("touchstart", stopSettling);
    };
    // Only the field param should re-trigger this - re-running on every
    // router.search change (e.g. an unrelated ?branch= navigation) would
    // undo the user's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.search]);
}
