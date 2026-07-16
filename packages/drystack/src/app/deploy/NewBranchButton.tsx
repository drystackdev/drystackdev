import { useState } from 'react';

import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { loader2Icon } from '@keystar/ui/icon/icons/loader2Icon';
import { plusIcon } from '@keystar/ui/icon/icons/plusIcon';
import { css, keyframes } from '@keystar/ui/style';
import { toastQueue } from '@keystar/ui/toast';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';

import { GitHubConfig } from '../../config';
import { createBrand, useSetBrandRecord } from '../brand';
import { useCreateBranchMutation } from '../branch-selection';
import { useRouter } from '../router';
import { useBranches, useRepoInfo } from '../shell/data';
import { useConfig } from '../shell/context';
import { useViewer } from '../shell/viewer-data';

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});
const spinningIconClassName = css({ animation: `${spin} 0.8s linear infinite` });

// Manual "start fresh" action, distinct from Deploy's automatic rotation
// (useDeploy.ts deletes the just-merged brand and creates its replacement).
// This one leaves the current brand branch exactly as-is on GitHub — it's for
// abandoning the current working branch without losing it, not for landing
// work — and just points the session at a brand-new branch off the default
// branch HEAD, same as brand.tsx's createBrand used everywhere else.
export function NewBranchButton() {
  const config = useConfig() as GitHubConfig;
  const repoInfo = useRepoInfo();
  const branches = useBranches();
  const viewer = useViewer();
  const [, createBranch] = useCreateBranchMutation();
  const setRecord = useSetBrandRecord();
  const { push, basePath } = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const onPress = async () => {
    if (!repoInfo || !viewer || isCreating) return;
    const defaultBranchInfo = branches.get(repoInfo.defaultBranch);
    if (!defaultBranchInfo) return;

    setIsCreating(true);
    try {
      const record = await createBrand(config, {
        createBranch,
        repositoryId: repoInfo.id,
        login: viewer.login,
        name: viewer.name ?? viewer.login,
        defaultBranchCommitOid: defaultBranchInfo.commitSha,
      });
      if (!record) {
        toastQueue.critical('Không thể tạo branch mới', { timeout: 4000 });
        return;
      }
      setRecord(record);
      push(`${basePath}/branch/${encodeURIComponent(record.ref)}`);
      toastQueue.positive('Đã tạo branch mới', { timeout: 2000 });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <TooltipTrigger>
      <ActionButton
        aria-label="Tạo branch mới"
        isDisabled={!repoInfo || !viewer || isCreating}
        onPress={onPress}
      >
        <Icon
          src={isCreating ? loader2Icon : plusIcon}
          UNSAFE_className={isCreating ? spinningIconClassName : undefined}
        />
      </ActionButton>
      <Tooltip>Tạo branch mới</Tooltip>
    </TooltipTrigger>
  );
}
