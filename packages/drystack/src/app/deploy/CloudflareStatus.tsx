import { Icon } from "@keystar/ui/icon";
import { alertCircleIcon } from "@keystar/ui/icon/icons/alertCircleIcon";
import { checkCircle2Icon } from "@keystar/ui/icon/icons/checkCircle2Icon";
import { cloudIcon } from "@keystar/ui/icon/icons/cloudIcon";
import { loader2Icon } from "@keystar/ui/icon/icons/loader2Icon";
import { css, keyframes } from "@keystar/ui/style";
import type { ReactElement } from "react";

import { useLatestBuildStatus } from "../build-status";
import { useLocalizedString } from "../shell/i18n";

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
// just differ in how much of the label they show at once.
export function useCloudflareStatusView(): {
  icon: ReactElement;
  tone: Tone;
  spinning: boolean;
  shortLabel: string;
  fullLabel: string;
  hasEvent: boolean;
} {
  const { event } = useLatestBuildStatus();
  const stringFormatter = useLocalizedString();

  if (!event) {
    return {
      icon: cloudIcon,
      tone: "neutral",
      spinning: false,
      shortLabel: stringFormatter.format("cfStatusNoBuildShort"),
      fullLabel: stringFormatter.format("cfStatusNoBuildFull"),
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
        shortLabel: stringFormatter.format("cfStatusBuildingShort"),
        fullLabel: stringFormatter.format("cfStatusBuildingFull"),
      };
    case "succeeded":
      return {
        ...base,
        icon: checkCircle2Icon,
        tone: "positive",
        spinning: false,
        shortLabel: stringFormatter.format("cfStatusSuccessShort"),
        fullLabel: stringFormatter.format("cfStatusSuccessFull"),
      };
    case "failed":
      return {
        ...base,
        icon: alertCircleIcon,
        tone: "critical",
        spinning: false,
        shortLabel: stringFormatter.format("cfStatusFailedShort"),
        fullLabel: stringFormatter.format("cfStatusFailedFull"),
      };
    case "canceled":
      return {
        ...base,
        icon: alertCircleIcon,
        tone: "critical",
        spinning: false,
        shortLabel: stringFormatter.format("cfStatusCanceledShort"),
        fullLabel: stringFormatter.format("cfStatusCanceledFull"),
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
