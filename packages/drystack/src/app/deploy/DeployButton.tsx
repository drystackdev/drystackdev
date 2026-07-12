import { useEffect, useRef, useState } from 'react';

import { ActionButton } from '@keystar/ui/button';
import { DialogContainer } from '@keystar/ui/dialog';
import { toastQueue } from '@keystar/ui/toast';
import { Text } from '@keystar/ui/typography';

import { watchBuildStatus } from '../build-status';
import { useCurrentBrand } from '../brand';
import { ConflictDialog } from './ConflictDialog';
import { useDeploy } from './useDeploy';

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
    setBuildLabel('Đang chờ build…');

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
        setBuildLabel('Đang cài đặt dependencies…');
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
        ? 'Đang chờ xử lý xung đột…'
        : 'Deploy';

  return (
    <>
      <ActionButton isDisabled={isBusy || !brand} onPress={() => deploy()}>
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
