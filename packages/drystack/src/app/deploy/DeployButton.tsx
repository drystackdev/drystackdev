import { ReactElement, useEffect, useRef, useState } from 'react';

import { ActionButton } from '@keystar/ui/button';
import { DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { alertCircleIcon } from '@keystar/ui/icon/icons/alertCircleIcon';
import { alertTriangleIcon } from '@keystar/ui/icon/icons/alertTriangleIcon';
import { loader2Icon } from '@keystar/ui/icon/icons/loader2Icon';
import { rocketIcon } from '@keystar/ui/icon/icons/rocketIcon';
import { css, keyframes } from '@keystar/ui/style';
import { toastQueue } from '@keystar/ui/toast';
import { Text } from '@keystar/ui/typography';

import { watchBuildStatus } from '../build-status';
import { useCurrentBrand } from '../brand';
import { ConflictDialog } from './ConflictDialog';
import { useDeploy } from './useDeploy';

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});
const spinningIconClassName = css({ animation: `${spin} 0.8s linear infinite` });

type DeployStatus = 'idle' | 'error' | 'loading' | 'conflicts' | 'building';

const statusIcons: Record<DeployStatus, ReactElement> = {
  idle: rocketIcon,
  error: alertCircleIcon,
  loading: loader2Icon,
  conflicts: alertTriangleIcon,
  building: loader2Icon,
};

// Merges the current brand into the default branch, then tracks the
// resulting Cloudflare build — see plan/brand.md §8. Progress lives on the
// button label itself (not a toast) the whole way through; the button stays
// disabled until the build settles. Only mounted in github mode (its call
// sites — SidebarGitActions, dashboard BranchSection — already gate that).
export function DeployButton() {
  const brand = useCurrentBrand();
  const { state, deploy, setHunkChoice, submitConflicts, cancelConflicts, reset } =
    useDeploy();
  const [buildLabel, setBuildLabel] = useState<string | null>(null);
  const trackedCommitRef = useRef<string | null>(null);

  useEffect(() => {
    if (state.kind !== 'merged') return;
    if (trackedCommitRef.current === state.commitOid) return;
    trackedCommitRef.current = state.commitOid;
    setBuildLabel('Waiting for build…');

    const settle = (toast: () => void) => {
      trackedCommitRef.current = null;
      setBuildLabel(null);
      reset();
      toast();
    };

    return watchBuildStatus(state.commitOid, update => {
      if (update.kind === 'label') {
        setBuildLabel(update.label);
        return;
      }
      if (update.kind === 'phase' && update.phase === 'started') {
        setBuildLabel('Installing dependencies…');
        return;
      }
      if (update.kind === 'timeout') {
        settle(() =>
          toastQueue.info('Build đang lâu hơn bình thường — kiểm tra lại sau.', {
            timeout: 8000,
          })
        );
        return;
      }
      if (update.kind === 'phase') {
        settle(() => {
          if (update.phase === 'succeeded') {
            toastQueue.positive('Nội dung đã được publish', { timeout: 4000 });
          } else {
            toastQueue.critical(
              'Build thất bại — thay đổi vẫn được lưu trên GitHub, thử lưu lại sau.',
              { timeout: 8000 }
            );
          }
        });
      }
    });
  }, [state, reset]);

  useEffect(() => {
    if (state.kind === 'idle' && state.error) {
      toastQueue.critical(state.error, { timeout: 6000 });
    }
  }, [state]);

  const isBuilding = buildLabel !== null;
  const isBusy = state.kind === 'loading' || state.kind === 'conflicts' || isBuilding;
  const label = isBuilding
    ? buildLabel
    : state.kind === 'loading'
      ? state.label
      : state.kind === 'conflicts'
        ? 'Waiting for conflict resolution…'
        : 'Deploy';

  const status: DeployStatus = isBuilding
    ? 'building'
    : state.kind === 'loading'
      ? 'loading'
      : state.kind === 'conflicts'
        ? 'conflicts'
        : state.kind === 'idle' && state.error
          ? 'error'
          : 'idle';
  const isSpinning = status === 'loading' || status === 'building';

  return (
    <>
      <ActionButton isDisabled={isBusy || !brand} width="100%" onPress={() => deploy()}>
        <Icon
          src={statusIcons[status]}
          UNSAFE_className={isSpinning ? spinningIconClassName : undefined}
        />
        <Text>{label}</Text>
      </ActionButton>

      <DialogContainer type="fullscreen" onDismiss={cancelConflicts}>
        {state.kind === 'conflicts' && (
          <ConflictDialog
            files={state.files}
            onChoice={setHunkChoice}
            onSubmit={submitConflicts}
            onCancel={cancelConflicts}
          />
        )}
      </DialogContainer>
    </>
  );
}
