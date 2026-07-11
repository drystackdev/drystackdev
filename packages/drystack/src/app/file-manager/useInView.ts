import { useEffect, useRef, useState } from 'react';

// Tracks whether the observed element is near the viewport, so callers can
// defer expensive work (e.g. fetching a thumbnail's blob content) until the
// item is actually about to be seen instead of doing it for every item in a
// long, unvirtualized list on mount.
export function useInView<T extends HTMLElement>(rootMargin = '200px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
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
  }, [rootMargin]);

  return [ref, inView] as const;
}
