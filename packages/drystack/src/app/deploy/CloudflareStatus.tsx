import { Icon } from '@keystar/ui/icon';
import { alertCircleIcon } from '@keystar/ui/icon/icons/alertCircleIcon';
import { checkCircle2Icon } from '@keystar/ui/icon/icons/checkCircle2Icon';
import { cloudIcon } from '@keystar/ui/icon/icons/cloudIcon';
import { loader2Icon } from '@keystar/ui/icon/icons/loader2Icon';
import { css, keyframes } from '@keystar/ui/style';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';

import { useLatestBuildStatus } from '../build-status';

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});
const spinningIconClassName = css({ animation: `${spin} 0.8s linear infinite` });

// Always-on Cloudflare build indicator, independent of DeployButton — it
// reflects whatever the most recent build on the site is doing, whoever
// triggered it, not just "the build I just started". See build-status.ts.
export function CloudflareStatus() {
  const { event } = useLatestBuildStatus();

  const { icon, tone, label, spinning } = (() => {
    if (!event) {
      return {
        icon: cloudIcon,
        tone: 'neutral' as const,
        label: 'Chưa có thông tin build',
        spinning: false,
      };
    }
    switch (event.phase) {
      case 'started':
        return {
          icon: loader2Icon,
          tone: 'notice' as const,
          label: 'Đang build trên Cloudflare…',
          spinning: true,
        };
      case 'succeeded':
        return {
          icon: checkCircle2Icon,
          tone: 'positive' as const,
          label: 'Build thành công',
          spinning: false,
        };
      case 'failed':
        return {
          icon: alertCircleIcon,
          tone: 'critical' as const,
          label: 'Build thất bại',
          spinning: false,
        };
      case 'canceled':
        return {
          icon: alertCircleIcon,
          tone: 'critical' as const,
          label: 'Build đã huỷ',
          spinning: false,
        };
    }
  })();

  const toneColor = {
    neutral: 'neutralSecondary',
    notice: 'accent',
    positive: 'positive',
    critical: 'critical',
  }[tone] as 'neutralSecondary' | 'accent' | 'positive' | 'critical';

  return (
    <TooltipTrigger>
      <Icon
        src={icon}
        color={toneColor}
        UNSAFE_className={spinning ? spinningIconClassName : undefined}
        aria-label={label}
      />
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
