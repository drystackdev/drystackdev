import { useState } from "react";

import { ActionButton, Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog, DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { plusIcon } from "@keystar/ui/icon/icons/plusIcon";
import { Flex } from "@keystar/ui/layout";
import { Content } from "@keystar/ui/slots";
import { css, tokenSchema } from "@keystar/ui/style";
import { TextField } from "@keystar/ui/text-field";
import { toastQueue } from "@keystar/ui/toast";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Heading, Text } from "@keystar/ui/typography";

import { GitHubConfig } from "../../config";
import { createBrand, useSetBrandRecord } from "../brand";
import { DEFAULT_BRANCH_PREFIX, formatBrandRef } from "../brand-label";
import {
  prettyErrorForCreateBranchMutation,
  useCreateBranchMutation,
} from "../branch-selection";
import { useRouter } from "../router";
import { useBranches, useRepoInfo } from "../shell/data";
import { useConfig } from "../shell/context";
import { useViewer } from "../shell/viewer-data";
import { getBranchPrefix } from "../utils";

// Manual "start fresh" action, distinct from Deploy's automatic rotation
// (useDeploy.ts deletes the just-merged brand and creates its replacement).
// This one leaves the current brand branch exactly as-is on GitHub - it's for
// abandoning the current working branch without losing it, not for landing
// work - and just points the session at a brand-new branch off the default
// branch HEAD, same as brand.tsx's createBrand used everywhere else. The
// dialog pre-fills the auto-generated name but lets the user override it -
// only the suffix is editable, the branch-prefix stays fixed since
// CurrentBrandChip/ensureBrand rely on every brand ref starting with it.
export function NewBranchButton() {
  const config = useConfig() as GitHubConfig;
  const repoInfo = useRepoInfo();
  const branches = useBranches();
  const viewer = useViewer();
  const [{ error, fetching }, createBranch] = useCreateBranchMutation();
  const setRecord = useSetBrandRecord();
  const { push, basePath } = useRouter();
  const branchPrefix = getBranchPrefix(config);
  const effectivePrefix = branchPrefix ?? DEFAULT_BRANCH_PREFIX;

  const [isOpen, setIsOpen] = useState(false);
  const [suffix, setSuffix] = useState("");

  const openDialog = () => {
    if (!repoInfo || !viewer) return;
    setSuffix(
      formatBrandRef(branchPrefix, new Date()).slice(effectivePrefix.length),
    );
    setIsOpen(true);
  };

  const onCreate = async () => {
    if (!repoInfo || !viewer) return;
    const defaultBranchInfo = branches.get(repoInfo.defaultBranch);
    if (!defaultBranchInfo) return;

    const record = await createBrand(config, {
      createBranch,
      repositoryId: repoInfo.id,
      login: viewer.login,
      name: viewer.name ?? viewer.login,
      defaultBranchCommitOid: defaultBranchInfo.commitSha,
      ref: effectivePrefix + suffix,
    });
    if (!record) return; // failure surfaces inline via `error` below

    setIsOpen(false);
    setRecord(record);
    push(`${basePath}/branch/${encodeURIComponent(record.ref)}`);
    toastQueue.positive("Đã tạo branch mới", { timeout: 2000 });
  };

  return (
    <>
      <TooltipTrigger>
        <ActionButton
          aria-label="Tạo branch mới"
          isDisabled={!repoInfo || !viewer}
          onPress={openDialog}
        >
          <Icon src={plusIcon} />
        </ActionButton>
        <Tooltip>Tạo branch mới</Tooltip>
      </TooltipTrigger>

      <DialogContainer onDismiss={() => setIsOpen(false)}>
        {isOpen && (
          <Dialog size="small">
            <form
              style={{ display: "contents" }}
              onSubmit={(event) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                void onCreate();
              }}
            >
              <Heading>Tạo branch mới</Heading>
              <Content>
                <TextField
                  label="Tên branch"
                  value={suffix}
                  onChange={setSuffix}
                  autoFocus
                  errorMessage={prettyErrorForCreateBranchMutation(error)}
                  UNSAFE_className={css({
                    "& input": {
                      paddingInlineStart: tokenSchema.size.space.xsmall,
                    },
                  })}
                  startElement={
                    <Flex
                      alignItems="center"
                      paddingStart="regular"
                      justifyContent="center"
                      pointerEvents="none"
                    >
                      <Text color="neutralSecondary">{effectivePrefix}</Text>
                    </Flex>
                  }
                />
              </Content>
              <ButtonGroup>
                <Button onPress={() => setIsOpen(false)} isDisabled={fetching}>
                  Hủy
                </Button>
                <Button isPending={fetching} prominence="high" type="submit">
                  Tạo
                </Button>
              </ButtonGroup>
            </form>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}
