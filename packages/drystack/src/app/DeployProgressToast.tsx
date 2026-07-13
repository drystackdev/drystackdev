import { useEffect, useRef, useState } from 'react';
import { toastQueue } from '@keystar/ui/toast';
import { Text } from '@keystar/ui/typography';
import { BuildPhase, watchBuildStatus } from './build-status';

function DeployProgressToastBody({
  commitOid,
  onSettled,
}: {
  commitOid: string;
  onSettled: (outcome: BuildPhase | 'timeout') => void;
}) {
  const [label, setLabel] = useState('Đang chờ build…');
  const settledRef = useRef(false);

  useEffect(() => {
    settledRef.current = false;
    return watchBuildStatus(commitOid, update => {
      if (update.kind === 'label') {
        setLabel(update.label);
        return;
      }
      if (update.kind === 'phase' && update.phase === 'started') {
        setLabel('Đang cài đặt dependencies…');
        return;
      }
      if (settledRef.current) return;
      if (update.kind === 'timeout') {
        settledRef.current = true;
        onSettled('timeout');
      } else if (update.kind === 'phase') {
        settledRef.current = true;
        onSettled(update.phase);
      }
    });
  }, [commitOid]);

  return <Text>{label}</Text>;
}

// Queues a neutral toast that tracks a commit's Cloudflare build over
// WebSocket, then calls `onSettled` once with the terminal outcome
// (`succeeded`/`failed`/`canceled`/`timeout`) so the caller can show its own
// follow-up toast.
export function showDeployProgressToast(
  commitOid: string,
  onSettled: (outcome: BuildPhase | 'timeout') => void
): void {
  const close = toastQueue.neutral(
    <DeployProgressToastBody
      commitOid={commitOid}
      onSettled={outcome => {
        close();
        onSettled(outcome);
      }}
    />
  );
}

// Tracks a commit's Cloudflare build as soon as `commitOid` is set, showing a
// deploy-progress toast followed by a success/failure toast. Guards against
// re-tracking the same commit across re-renders.
export function useDeployProgressToast(commitOid: string | undefined) {
  const trackedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!commitOid || trackedRef.current === commitOid) return;
    trackedRef.current = commitOid;
    showDeployProgressToast(commitOid, outcome => {
      if (outcome === 'succeeded') {
        toastQueue.positive('Nội dung đã được publish', { timeout: 4000 });
      } else if (outcome === 'failed' || outcome === 'canceled') {
        toastQueue.critical(
          'Build thất bại — thay đổi vẫn được lưu trên GitHub, thử lưu lại sau.',
          { timeout: 8000 }
        );
      } else {
        toastQueue.info(
          'Build đang lâu hơn bình thường — kiểm tra lại sau.',
          { timeout: 8000 }
        );
      }
    });
  }, [commitOid]);
}
