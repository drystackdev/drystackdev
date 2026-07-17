import { Icon } from "@keystar/ui/icon";
import { alertCircleIcon } from "@keystar/ui/icon/icons/alertCircleIcon";
import { checkCircle2Icon } from "@keystar/ui/icon/icons/checkCircle2Icon";
import { cloudIcon } from "@keystar/ui/icon/icons/cloudIcon";
import { loader2Icon } from "@keystar/ui/icon/icons/loader2Icon";
import { css, keyframes } from "@keystar/ui/style";
import type { ReactElement } from "react";

import { useLatestBuildStatus } from "../build-status";

const spin = keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});
const spinningIconClassName = css({
  animation: `${spin} 0.8s linear infinite`,
});

export type Tone = "neutral" | "notice" | "positive" | "critical";

// Exported so DeployButton can color its own Cloudflare-status icon with the
// same palette instead of re-deriving it.
export const toneColor: Record<
  Tone,
  "neutralSecondary" | "accent" | "positive" | "critical"
> = {
  neutral: "neutralSecondary",
  notice: "accent",
  positive: "positive",
  critical: "critical",
};

// Shared read of "what's Cloudflare doing right now" - both the admin sidebar
// row and the VEI pill's compact indicator render off the same event, they
// just differ in how much of the label they show at once. English labels:
// this is a system/status string, not site content - see CLAUDE.md language
// convention (deploy toasts elsewhere stay Vietnamese; this doesn't).
export function useCloudflareStatusView(): {
  icon: ReactElement;
  tone: Tone;
  spinning: boolean;
  shortLabel: string;
  fullLabel: string;
  hasEvent: boolean;
} {
  const { event } = useLatestBuildStatus();

  if (!event) {
    return {
      icon: cloudIcon,
      tone: "neutral",
      spinning: false,
      shortLabel: "No build",
      fullLabel: "No build info yet",
      hasEvent: false,
    };
  }
  const base = { hasEvent: true } as const;
  switch (event.phase) {
    case "started":
      return {
        ...base,
        icon: loader2Icon,
        tone: "notice",
        spinning: true,
        shortLabel: "Building",
        fullLabel: "Building on Cloudflare…",
      };
    case "succeeded":
      return {
        ...base,
        icon: checkCircle2Icon,
        tone: "positive",
        spinning: false,
        shortLabel: "Success",
        fullLabel: "Build succeeded",
      };
    case "failed":
      return {
        ...base,
        icon: alertCircleIcon,
        tone: "critical",
        spinning: false,
        shortLabel: "Failed",
        fullLabel: "Build failed",
      };
    case "canceled":
      return {
        ...base,
        icon: alertCircleIcon,
        tone: "critical",
        spinning: false,
        shortLabel: "Canceled",
        fullLabel: "Build canceled",
      };
  }
}

// VEI HUD - folded into the toolbar's plain-text active-spot readout (see
// Toolbar.tsx's .dry-active-spot / editor.css's .dry-active-spot-status),
// not a standalone control: previously rendered as an outlined ActionButton
// (matching the brand chip's chrome) which read as a clickable button even
// though it never had an onPress. Now it's just a small icon + small text,
// same flat/un-styled treatment as the rest of that debug readout. `busy`/
// `busyLabel` cover Save's merge/deploy window (see useVeiDeploy) - before
// Cloudflare has anything of its own to report yet; once that clears this
// reflects whatever the build WS says (useCloudflareStatusView).
export function CloudflareStatusInline({
  busy,
  busyLabel,
}: {
  busy: boolean;
  busyLabel: string;
}) {
  const view = useCloudflareStatusView();
  const icon = busy ? loader2Icon : view.icon;
  const tone: Tone = busy ? "notice" : view.tone;
  const spinning = busy || view.spinning;
  const label = busy ? busyLabel : view.shortLabel;
  return (
    <span
      className="dry-active-spot-status"
      aria-label={busy ? busyLabel : view.fullLabel}
    >
      <Icon
        src={icon}
        size="small"
        color={toneColor[tone]}
        UNSAFE_className={spinning ? spinningIconClassName : undefined}
      />
      {label}
    </span>
  );
}
