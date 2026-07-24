import { useEffect, useState } from "react";
import { TooltipTrigger, type TooltipTriggerProps } from "@keystar/ui/tooltip";

// react-aria's calculatePosition (wired through useOverlayPosition, which
// @keystar/ui/tooltip's TooltipTrigger/Tooltip build on) computes an open
// tooltip's top/left once, when it opens, and never recalculates for a plain
// window/document scroll - only for a *nested* scrollable ancestor other
// than body/window (useOverlayPosition's own comment). @keystar/ui never
// wires up the `onClose` react-aria's useOverlayPosition would otherwise
// pass to its internal useCloseOnScroll, so today a tooltip left open while
// the page scrolls visually drifts away from its trigger instead of closing
// - most visible on VEI's `position: fixed` toolbar, whose buttons never
// move on scroll while a tooltip computed relative to the pre-scroll
// document position does.
function useScrollDismissTooltip() {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    const onScroll = () => setIsOpen(false);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [isOpen]);
  return { isOpen, onOpenChange: setIsOpen } as const;
}

// Drop-in replacement for `@keystar/ui/tooltip`'s `TooltipTrigger` that
// additionally closes on scroll (see useScrollDismissTooltip above) - a
// component, not just the hook directly, specifically so it's safe to use
// from inside a `.map()` callback or a `useMemo()`-returned JSX tree (both
// common in this editor's toolbar/popover code): a hook call would violate
// the Rules of Hooks in either spot (not a component's own top-level render,
// and/or called a variable number of times), but creating a `<ScrollDismiss
// TooltipTrigger>` element is just data - React only actually runs its body
// (and so this hook) once it renders that element as its own component
// instance, which is always valid regardless of what JS produced the JSX.
//
// Every prop except `isOpen`/`onOpenChange` passes straight through; those
// two are always controlled by useScrollDismissTooltip here on purpose - a
// caller that also needs to control open state itself would need a
// different composition (none currently do).
export function ScrollDismissTooltipTrigger(
  props: Omit<TooltipTriggerProps, "isOpen" | "onOpenChange">,
) {
  const scrollDismiss = useScrollDismissTooltip();
  return <TooltipTrigger {...props} {...scrollDismiss} />;
}
