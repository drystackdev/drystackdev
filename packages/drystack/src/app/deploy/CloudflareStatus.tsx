import { Icon } from '@keystar/ui/icon';
import { alertCircleIcon } from '@keystar/ui/icon/icons/alertCircleIcon';
import { checkCircle2Icon } from '@keystar/ui/icon/icons/checkCircle2Icon';
import { cloudIcon } from '@keystar/ui/icon/icons/cloudIcon';
import { loader2Icon } from '@keystar/ui/icon/icons/loader2Icon';
import { HStack } from '@keystar/ui/layout';
import { css, keyframes } from '@keystar/ui/style';
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
// just differ in how much of the label they show at once.
function useCloudflareStatusView(): {
  icon: ReactElement;
  tone: Tone;
  spinning: boolean;
  shortLabel: string;
  fullLabel: string;
} {
  const { event } = useLatestBuildStatus();

  if (!event) {
    return {
      icon: cloudIcon,
      tone: 'neutral',
      spinning: false,
      shortLabel: 'Chưa build',
      fullLabel: 'Chưa có thông tin build',
    };
  }
  switch (event.phase) {
    case 'started':
      return {
        icon: loader2Icon,
        tone: 'notice',
        spinning: true,
        shortLabel: 'Đang build',
        fullLabel: 'Đang build trên Cloudflare…',
      };
    case 'succeeded':
      return {
        icon: checkCircle2Icon,
        tone: 'positive',
        spinning: false,
        shortLabel: 'Thành công',
        fullLabel: 'Build thành công',
      };
    case 'failed':
      return {
        icon: alertCircleIcon,
        tone: 'critical',
        spinning: false,
        shortLabel: 'Thất bại',
        fullLabel: 'Build thất bại',
      };
    case 'canceled':
      return {
        icon: alertCircleIcon,
        tone: 'critical',
        spinning: false,
        shortLabel: 'Đã huỷ',
        fullLabel: 'Build đã huỷ',
      };
  }
}

// Admin sidebar — its own row, icon plus the full descriptive label. Always
// on, independent of DeployButton: reflects whatever the most recent build on
// the site is doing, whoever triggered it, not just "the build I just
// started". See build-status.ts.
export function CloudflareStatus() {
  const view = useCloudflareStatusView();
  return (
    <HStack gap="small" alignItems="center" paddingY="small">
      <Icon
        src={view.icon}
        color={toneColor[view.tone]}
        UNSAFE_className={view.spinning ? spinningIconClassName : undefined}
      />
      <Text color={toneColor[view.tone]}>{view.fullLabel}</Text>
    </HStack>
  );
}

// VEI pill — space is tight, so this sits where the brand chip used to
// (Toolbar.tsx moved the brand name into the Deploy button's own tooltip).
// The label is always one of a handful of short, similar-length strings so
// the pill doesn't jump around as the status changes; the full sentence is
// still one hover away.
export function CloudflareStatusCompact() {
  const view = useCloudflareStatusView();
  return (
    <TooltipTrigger>
      <div
        className="dry-brandchip"
        style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
      >
        <Icon
          src={view.icon}
          color={toneColor[view.tone]}
          UNSAFE_className={view.spinning ? spinningIconClassName : undefined}
        />
        <span style={{ minWidth: '6ch', textAlign: 'left' }}>
          <Text color={toneColor[view.tone]}>{view.shortLabel}</Text>
        </span>
      </div>
      <Tooltip>{view.fullLabel}</Tooltip>
    </TooltipTrigger>
  );
}
