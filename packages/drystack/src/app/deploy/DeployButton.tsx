import { ReactElement, useEffect, useRef } from 'react';

import { ActionButton } from '@keystar/ui/button';
import { DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { alertCircleIcon } from '@keystar/ui/icon/icons/alertCircleIcon';
import { alertTriangleIcon } from '@keystar/ui/icon/icons/alertTriangleIcon';
import { loader2Icon } from '@keystar/ui/icon/icons/loader2Icon';
import { rocketIcon } from '@keystar/ui/icon/icons/rocketIcon';
import { Flex } from '@keystar/ui/layout';
import { css, keyframes } from '@keystar/ui/style';
import { toastQueue } from '@keystar/ui/toast';
import { Text } from '@keystar/ui/typography';

import { useCurrentBrand } from '../brand';
import { useChanged } from '../shell/data';
import { ConflictDialog } from './ConflictDialog';
import { toneColor, useCloudflareStatusView } from './CloudflareStatus';
import { useDeploy } from './useDeploy';

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});
const spinningIconClassName = css({ animation: `${spin} 0.8s linear infinite` });

type DeployStatus = 'idle' | 'error' | 'loading' | 'conflicts';

const statusIcons: Record<DeployStatus, ReactElement> = {
  idle: rocketIcon,
  error: alertCircleIcon,
  loading: loader2Icon,
  conflicts: alertTriangleIcon,
};

// Same "anything different from main" signal the sidebar nav already uses
// for its per-collection/singleton "changed" badges (useNavItems.tsx) — reused
// here so Deploy disables itself the moment the brand catches back up to main,
// instead of only finding out after a round trip (useDeploy's own "nothing to
// deploy" error).
function useHasChangesToMerge(changed: ReturnType<typeof useChanged>): boolean {
  if (changed.singletons.size > 0) return true;
  for (const c of changed.collections.values()) {
    if (c.added.size > 0 || c.removed.size > 0 || c.changed.size > 0) return true;
  }
  return false;
}

// Merges the current brand into the default branch — nothing more. Whether
// Cloudflare actually builds it successfully is tracked separately by
// useCloudflareStatusView (deploy/CloudflareStatus.tsx), which listens for
// build events regardless of who triggered them or when — this button
// doesn't wait around for the merge to land, it just reports it and goes
// back to idle. It does, however, stay disabled for as long as Cloudflare is
// actively building (see isBuilding below), so people can't queue up a
// second deploy on top of one whose build hasn't finished yet.
export function DeployButton() {
  const brand = useCurrentBrand();
  const hasChanges = useHasChangesToMerge(useChanged());
  const { state, deploy, setHunkChoice, submitConflicts, cancelConflicts, reset } =
    useDeploy();
  const cf = useCloudflareStatusView();

  useEffect(() => {
    if (state.kind !== 'merged') return;
    toastQueue.positive('Đã gộp vào main — theo dõi build ở biểu tượng Cloudflare', {
      timeout: 4000,
    });
    reset();
  }, [state, reset]);

  useEffect(() => {
    if (state.kind !== 'idle' || !state.error) return;
    const { pullRequestURL } = state;
    // A protected default branch needs the editor to go open a PR, so that
    // toast sticks around until dismissed instead of timing out mid-read.
    toastQueue.critical(
      state.error,
      pullRequestURL
        ? {
            actionLabel: 'Mở pull request',
            onAction: () => window.open(pullRequestURL, '_blank', 'noopener'),
            shouldCloseOnAction: true,
          }
        : { timeout: 6000 }
    );
  }, [state]);

  // Notify once the moment Cloudflare finishes a build that was in progress —
  // the button itself is disabled for the whole `started` phase, so this is
  // the only signal telling the editor it's safe to deploy again.
  const wasBuildingRef = useRef(false);
  useEffect(() => {
    if (wasBuildingRef.current && cf.tone === 'positive') {
      toastQueue.positive('Build thành công trên Cloudflare — có thể deploy tiếp', {
        timeout: 4000,
      });
    }
    wasBuildingRef.current = cf.spinning;
  }, [cf.tone, cf.spinning]);

  const isBusy = state.kind === 'loading' || state.kind === 'conflicts';
  const isBuilding = cf.hasEvent && cf.spinning;
  const label =
    state.kind === 'loading'
      ? state.label
      : state.kind === 'conflicts'
        ? 'Waiting for conflict resolution…'
        : isBuilding
          ? cf.fullLabel
          : 'Deploy';

  const status: DeployStatus =
    state.kind === 'loading'
      ? 'loading'
      : state.kind === 'conflicts'
        ? 'conflicts'
        : state.kind === 'idle' && state.error
          ? 'error'
          : 'idle';
  const isSpinning = status === 'loading';

  return (
    <>
      <ActionButton
        isDisabled={isBusy || !brand || !hasChanges || isBuilding}
        width="100%"
        onPress={() => deploy()}
      >
        <Flex
          position="absolute"
          insetStart="regular"
          insetTop={0}
          insetBottom={0}
          alignItems="center"
        >
          <Icon
            src={cf.icon}
            color={toneColor[cf.tone]}
            UNSAFE_className={cf.spinning ? spinningIconClassName : undefined}
          />
        </Flex>
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
