import { useMemo, useRef, useState } from "react";
import { PressResponder } from "@react-aria/interactions";
import { useOverlayTrigger } from "@react-aria/overlays";
import { useOverlayTriggerState } from "@react-stately/overlays";

import { ActionButton } from "@keystar/ui/button";
import { AlertDialog, DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { chevronDownIcon } from "@keystar/ui/icon/icons/chevronDownIcon";
import { gitBranchIcon } from "@keystar/ui/icon/icons/gitBranchIcon";
import { trashIcon } from "@keystar/ui/icon/icons/trashIcon";
import { HStack, VStack } from "@keystar/ui/layout";
import { Popover } from "@keystar/ui/overlays";
import { css, tokenSchema } from "@keystar/ui/style";
import { toastQueue } from "@keystar/ui/toast";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Text } from "@keystar/ui/typography";

import { useCurrentBrand } from "../brand";
import { brandRefDisplayLabel, isBrandRef } from "../brand-label";
import { useDeleteBranchMutation } from "../branch-selection";
import { useRouter } from "../router";
import { useConfig } from "../shell/context";
import { useBranches, useRepoInfo } from "../shell/data";
import { useViewer } from "../shell/viewer-data";
import { getBranchPrefix } from "../utils";

export function CurrentBrandChip() {
  const brand = useCurrentBrand();
  const branches = useBranches();
  const repoInfo = useRepoInfo();
  const viewer = useViewer();
  const router = useRouter();
  const config = useConfig();
  const branchPrefix = getBranchPrefix(config);
  const [, deleteBranch] = useDeleteBranchMutation();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const state = useOverlayTriggerState({});
  const { triggerProps, overlayProps } = useOverlayTrigger(
    { type: "dialog" },
    state,
    triggerRef,
  );
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const label = brand ? brandRefDisplayLabel(brand.ref, branchPrefix) : "";

  // Only brands belong in this list: the default branch is never a brand
  // (plan/brand.md §1/§5), and a repo's other branches aren't ours to offer.
  // The current brand is always included even if it somehow lacks the prefix -
  // hiding the branch you're on would be worse than showing an odd name.
  const brandBranches = useMemo(() => {
    return Array.from(branches.entries())
      .filter(
        ([name]) =>
          name !== repoInfo?.defaultBranch &&
          (isBrandRef(name, branchPrefix) || name === brand?.ref),
      )
      // refs are timestamped, so a plain string sort is chronological -
      // reversed to put the newest brand at the top.
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([name, info]) => ({
        name,
        // A brand that's been created but not committed to still points at the
        // default branch's tip, so its "author" is whoever last landed there.
        // Treating that as ownership would paint someone else's dot on a brand
        // that is in fact unclaimed, so only trust the author once the brand
        // has moved off the branch it was cut from.
        owner:
          info.commitSha === branches.get(repoInfo?.defaultBranch ?? "")?.commitSha
            ? null
            : info.authorLogin,
        isCurrent: name === brand?.ref,
      }));
  }, [branches, repoInfo?.defaultBranch, brand?.ref, branchPrefix]);

  const switchTo = (branchName: string) => {
    state.close();
    if (branchName === brand?.ref) return;
    router.push(`${router.basePath}/branch/${encodeURIComponent(branchName)}`);
  };

  const confirmDelete = async (branchName: string) => {
    const branchInfo = branches.get(branchName);
    if (!branchInfo) {
      toastQueue.critical("Không tìm thấy branch");
      return;
    }
    const result = await deleteBranch({ refId: branchInfo.id });
    if (result.error) {
      toastQueue.critical(result.error.message);
      return;
    }
    toastQueue.positive("Đã xoá branch", { timeout: 2000 });
    setPendingDelete(null);
  };

  return (
    <>
      <PressResponder {...triggerProps} isPressed={state.isOpen}>
        <ActionButton
          ref={triggerRef}
          isDisabled={!brand || brandBranches.length === 0}
          aria-label="Chọn branch"
          flex
          minWidth={0}
          UNSAFE_className={css({ justifyContent: "space-between" })}
        >
          <HStack flex minWidth={0} gap="regular" alignItems="center">
            <Icon src={gitBranchIcon} />
            <Text truncate>{label}</Text>
          </HStack>
          <Icon src={chevronDownIcon} />
        </ActionButton>
      </PressResponder>

      <Popover
        {...overlayProps}
        state={state}
        triggerRef={triggerRef}
        placement="top start"
        hideArrow
      >
        <VStack
          padding="regular"
          gap="small"
          minWidth="alias.singleLineWidth"
          maxHeight="scale.3400"
          UNSAFE_className={css({ overflowY: "auto" })}
        >
          {brandBranches.map((branch) => (
            <HStack key={branch.name} gap="regular" alignItems="center">
              <button
                type="button"
                onClick={() => switchTo(branch.name)}
                className={css({
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: tokenSchema.size.space.regular,
                  padding: tokenSchema.size.space.regular,
                  border: "none",
                  borderRadius: tokenSchema.size.radius.small,
                  cursor: "pointer",
                  textAlign: "start",
                  backgroundColor: branch.isCurrent
                    ? tokenSchema.color.background.accentEmphasis
                    : "transparent",
                  "&:hover": {
                    backgroundColor: tokenSchema.color.alias.backgroundHovered,
                  },
                })}
              >
                <div
                  aria-hidden
                  className={css({
                    width: tokenSchema.size.space.small,
                    height: tokenSchema.size.space.small,
                    borderRadius: "50%",
                    flexShrink: 0,
                    backgroundColor:
                      branch.owner && branch.owner === viewer?.login
                        ? tokenSchema.color.foreground.accent
                        : tokenSchema.color.foreground.neutralTertiary,
                  })}
                />
                {/* `trim` off: capsize's leading-trim margins are meant for a
                    lone run of text, and pull two stacked Texts over each other. */}
                <VStack flex minWidth={0}>
                  <Text
                    trim={false}
                    truncate
                    weight={branch.isCurrent ? "semibold" : "regular"}
                  >
                    {brandRefDisplayLabel(branch.name, branchPrefix)}
                  </Text>
                  <Text trim={false} truncate size="small" color="neutralTertiary">
                    {branch.owner
                      ? branch.owner === viewer?.login
                        ? "Của bạn"
                        : branch.owner
                      : "Chưa có thay đổi"}
                  </Text>
                </VStack>
              </button>
              {!branch.isCurrent && (
                <TooltipTrigger>
                  <ActionButton
                    prominence="low"
                    aria-label={`Xoá branch ${brandRefDisplayLabel(branch.name, branchPrefix)}`}
                    onPress={() => setPendingDelete(branch.name)}
                  >
                    <Icon src={trashIcon} />
                  </ActionButton>
                  <Tooltip>Xoá branch</Tooltip>
                </TooltipTrigger>
              )}
            </HStack>
          ))}
        </VStack>
      </Popover>

      <DialogContainer onDismiss={() => setPendingDelete(null)}>
        {pendingDelete && (
          <AlertDialog
            title="Xoá branch?"
            tone="critical"
            cancelLabel="Hủy"
            primaryActionLabel="Xoá"
            autoFocusButton="cancel"
            onPrimaryAction={() => confirmDelete(pendingDelete)}
          >
            <Text>
              Mọi thay đổi chưa deploy trên{" "}
              <strong>{brandRefDisplayLabel(pendingDelete, branchPrefix)}</strong>{" "}
              sẽ mất vĩnh viễn.
            </Text>
          </AlertDialog>
        )}
      </DialogContainer>
    </>
  );
}
