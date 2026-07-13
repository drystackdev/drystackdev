import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { alertCircleIcon } from '@keystar/ui/icon/icons/alertCircleIcon';
import { checkCircle2Icon } from '@keystar/ui/icon/icons/checkCircle2Icon';
import { cloudIcon } from '@keystar/ui/icon/icons/cloudIcon';
import { loader2Icon } from '@keystar/ui/icon/icons/loader2Icon';
import { css, keyframes } from '@keystar/ui/style';
import { toastQueue } from '@keystar/ui/toast';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';
import { Text } from '@keystar/ui/typography';
import type { ReactElement } from 'react';

import { useLatestBuildStatus } from '../build-status';

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});
const spinningIconClassName = css({ animation: `${spin} 0.8s linear infinite` });

type Tone = 'neutral' | 'notice' | 'positive' | 'critical';

const toneColor: Record<Tone, 'neutralSecondary' | 'accent' | 'positive' | 'critical'> = {
  neutral: 'neutralSecondary',
  notice: 'accent',
  positive: 'positive',
  critical: 'critical',
};

// Shared read of "what's Cloudflare doing right now" — both the admin sidebar
// row and the VEI pill's compact indicator render off the same event, they
// just differ in how much of the label they show at once. English labels:
// this is a system/status string, not site content — see CLAUDE.md language
// convention (deploy toasts elsewhere stay Vietnamese; this doesn't).
function useCloudflareStatusView(): {
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
      tone: 'neutral',
      spinning: false,
      shortLabel: 'No build',
      fullLabel: 'No build info yet',
      hasEvent: false,
    };
  }
  const base = { hasEvent: true } as const;
  switch (event.phase) {
    case 'started':
      return {
        ...base,
        icon: loader2Icon,
        tone: 'notice',
        spinning: true,
        shortLabel: 'Building',
        fullLabel: 'Building on Cloudflare…',
      };
    case 'succeeded':
      return {
        ...base,
        icon: checkCircle2Icon,
        tone: 'positive',
        spinning: false,
        shortLabel: 'Success',
        fullLabel: 'Build succeeded',
      };
    case 'failed':
      return {
        ...base,
        icon: alertCircleIcon,
        tone: 'critical',
        spinning: false,
        shortLabel: 'Failed',
        fullLabel: 'Build failed',
      };
    case 'canceled':
      return {
        ...base,
        icon: alertCircleIcon,
        tone: 'critical',
        spinning: false,
        shortLabel: 'Canceled',
        fullLabel: 'Build canceled',
      };
  }
}

// Admin sidebar — its own row, styled as the same outlined ActionButton as
// CurrentBrandChip (deploy/CurrentBrandChip.tsx) so the status/brand/deploy
// stack reads as one consistent set of rows. Always on, independent of
// DeployButton: reflects whatever the most recent build on the site is
// doing, whoever triggered it, not just "the build I just started" — see
// build-status.ts. Press-to-copy mirrors the brand chip's own affordance.
export function CloudflareStatus() {
  const view = useCloudflareStatusView();
  return (
    <ActionButton
      isDisabled={!view.hasEvent}
      width="100%"
      minWidth={0}
      onPress={() => {
        navigator.clipboard.writeText(view.fullLabel);
        toastQueue.positive('Đã copy trạng thái build', { timeout: 2000 });
      }}
    >
      <Icon
        src={view.icon}
        color={toneColor[view.tone]}
        UNSAFE_className={view.spinning ? spinningIconClassName : undefined}
      />
      <Text truncate flex minWidth={0}>
        {view.fullLabel}
      </Text>
    </ActionButton>
  );
}

// VEI pill — space is tight, so this sits where the brand chip used to
// (Toolbar.tsx moved the brand name into the Deploy button's own tooltip).
// Reuses the brand chip's own ActionButton + "dry-brandchip" class (same
// 40px height, same border-radius, same outlined Keystar chrome as the
// Deploy button next to it) rather than a bare div, so it actually looks
// like a matching control instead of flat text floating in the pill. The
// label is always one of a handful of short, similar-length strings so the
// pill doesn't jump around as the status changes; the full sentence is
// still one hover away.
export function CloudflareStatusCompact() {
  const view = useCloudflareStatusView();
  return (
    <TooltipTrigger>
      <ActionButton
        isDisabled={!view.hasEvent}
        UNSAFE_className="dry-brandchip"
        aria-label="Cloudflare build status"
        onPress={() => {
          navigator.clipboard.writeText(view.fullLabel);
          toastQueue.positive('Đã copy trạng thái build', { timeout: 2000 });
        }}
      >
        <Icon
          src={view.icon}
          color={toneColor[view.tone]}
          UNSAFE_className={view.spinning ? spinningIconClassName : undefined}
        />
        <Text>{view.shortLabel}</Text>
      </ActionButton>
      <Tooltip>{view.fullLabel}</Tooltip>
    </TooltipTrigger>
  );
}
