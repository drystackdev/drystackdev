import { useCallback, useEffect, useState } from 'react';

// Tracks whether the observed element is near the viewport, so callers can
// defer expensive work (e.g. fetching a thumbnail's blob content) until the
// item is actually about to be seen instead of doing it for every item in a
// long, unvirtualized list on mount.
//
// Uses a callback ref (not `useRef` + an effect keyed on `rootMargin`) so the
// observer is (re)created whenever the DOM node itself changes - not just on
// mount. Callers like `ImageCell` conditionally render the ref'd element
// (e.g. it's `null` while the row's data is still loading, then a real node
// once it resolves): with a plain `useRef`, the mount-time effect would see
// `ref.current === null`, bail out, and never run again since `rootMargin`
// never changes - permanently stranding `inView` at `false`.
export function useInView<T extends HTMLElement>(rootMargin = '400px') {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, rootMargin]);

  return [ref, inView] as const;
}
