import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ActionButton } from "@keystar/ui/button";
import { Icon } from "@keystar/ui/icon";
import { gitBranchIcon } from "@keystar/ui/icon/icons/gitBranchIcon";
import { trashIcon } from "@keystar/ui/icon/icons/trashIcon";
import { chevronDownIcon } from "@keystar/ui/icon/icons/chevronDownIcon";
import { AlertDialog, DialogContainer } from "@keystar/ui/dialog";
import { toastQueue } from "@keystar/ui/toast";
import { Text } from "@keystar/ui/typography";
import { HStack, VStack } from "@keystar/ui/layout";
import { css, tokenSchema } from "@keystar/ui/style";

import { useCurrentBrand } from "../brand";
import { brandDisplayLabel } from "../brand-label";
import { useRouter } from "../router";
import { useBranches } from "../shell/data";
import { useViewer } from "../shell/viewer-data";
import { useDeleteBranchMutation } from "../branch-selection";

export function CurrentBrandChip() {
  const brand = useCurrentBrand();
  const branches = useBranches();
  const viewer = useViewer();
  const router = useRouter();
  const [, deleteBranch] = useDeleteBranchMutation();

  const label = brand ? brandDisplayLabel(brand.label) : "";
  const chipRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, bottom: 0 });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>();

  useEffect(() => {
    const openMenu = () => {
      clearTimeout(closeTimer.current);
      if (!chipRef.current || !brand) return;
      const rect = chipRef.current.getBoundingClientRect();
      setMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
      setMenuOpen(true);
    };

    const scheduleCloseMenu = () => {
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setMenuOpen(false), 140);
    };

    const chipElement = chipRef.current;
    if (chipElement) {
      chipElement.addEventListener("mouseenter", openMenu);
      chipElement.addEventListener("mouseleave", scheduleCloseMenu);
    }

    return () => {
      if (chipElement) {
        chipElement.removeEventListener("mouseenter", openMenu);
        chipElement.removeEventListener("mouseleave", scheduleCloseMenu);
      }
      clearTimeout(closeTimer.current);
    };
  }, [brand]);

  const getBranchOwner = (branchName: string): string | null => {
    // Parse branch name to extract owner/login
    // Format: drystack/YYYY-MM-DD-HHmmss-login
    const match = branchName.match(/[/-]([a-z0-9-]+)$/);
    return match ? match[1] : null;
  };

  const isOwnBranch = (branchName: string): boolean => {
    if (!viewer) return false;
    const owner = getBranchOwner(branchName);
    return owner === viewer.login;
  };

  const branchList = Array.from(branches.keys())
    .sort()
    .map((name) => ({
      name,
      isOwn: isOwnBranch(name),
      isCurrent: name === brand?.ref,
    }));

  const handleSwitchBranch = (branchName: string) => {
    if (branchName === brand?.ref) {
      setMenuOpen(false);
      return;
    }
    const encodedBranch = encodeURIComponent(branchName);
    router.push(`${router.basePath}/branch/${encodedBranch}`);
    setMenuOpen(false);
  };

  const handleDeleteBranch = async (branchName: string) => {
    try {
      const branchInfo = branches.get(branchName);
      if (!branchInfo) {
        toastQueue.critical("Không tìm thấy branch info");
        return;
      }
      const [deleteResult] = await deleteBranch({ refId: branchInfo.id });
      if (deleteResult.error) {
        throw new Error(deleteResult.error.message);
      }
      toastQueue.positive("Đã xoá branch", { timeout: 2000 });
      setDeleteDialogOpen(false);
      setSelectedBranch(null);
      setMenuOpen(false);
    } catch (err) {
      toastQueue.critical(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <div
        ref={chipRef}
        className={css({
          flex: "1",
          minWidth: 0,
        })}
      >
        <ActionButton
          isDisabled={!brand}
          flex={1}
          minWidth={0}
          UNSAFE_className={css({
            justifyContent: "space-between",
          })}
        >
          <HStack flex minWidth={0} gap="regular">
            <Icon src={gitBranchIcon} />
            <Text truncate flex minWidth={0} title={label}>
              {label}
            </Text>
          </HStack>
          <Icon src={chevronDownIcon} />
        </ActionButton>
      </div>

      {menuOpen &&
        branchList.length > 0 &&
        typeof document !== "undefined" &&
        document.body &&
        createPortal(
          <div
            className={css({
              position: "fixed",
              left: menuPos.left,
              bottom: menuPos.bottom,
              backgroundColor: tokenSchema.color.background.surface,
              border: `1px solid ${tokenSchema.color.border.muted}`,
              borderRadius: tokenSchema.size.radius.medium,
              boxShadow: `${tokenSchema.size.shadow.large} ${tokenSchema.color.shadow.regular}`,
              zIndex: 1000,
              minWidth: 250,
              maxHeight: 400,
              overflowY: "auto",
            })}
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={() => {
              clearTimeout(closeTimer.current);
              closeTimer.current = setTimeout(() => setMenuOpen(false), 140);
            }}
          >
            <VStack gap={0}>
              {branchList.map((branch, index) => (
                <div
                  key={branch.name}
                  className={css({
                    display: "flex",
                    alignItems: "center",
                    padding: `${tokenSchema.size.space.regular} ${tokenSchema.size.space.medium}`,
                    backgroundColor: branch.isCurrent
                      ? tokenSchema.color.background.canvas
                      : "transparent",
                    cursor: "pointer",
                    "&:hover": {
                      backgroundColor: tokenSchema.color.background.canvas,
                    },
                  })}
                >
                  <div
                    className={css({
                      display: "flex",
                      alignItems: "center",
                      gap: tokenSchema.size.space.regular,
                      flex: 1,
                      minWidth: 0,
                    })}
                    onClick={() => handleSwitchBranch(branch.name)}
                  >
                    {/* Dot indicator */}
                    <div
                      className={css({
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: branch.isOwn
                          ? tokenSchema.color.foreground.positive
                          : tokenSchema.color.foreground.negative,
                        flexShrink: 0,
                      })}
                    />
                    <div
                      className={css({
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                      })}
                    >
                      <Text
                        truncate
                        className={css({
                          fontWeight: branch.isCurrent ? "bold" : "normal",
                        })}
                      >
                        {branch.name}
                      </Text>
                      <Text
                        size="small"
                        color="neutralTertiary"
                        truncate
                      >
                        {branch.isOwn ? viewer?.login : `By ${getBranchOwner(branch.name)}`}
                      </Text>
                    </div>
                  </div>
                  {branch.name !== "main" && !branch.isCurrent && (
                    <ActionButton
                      isQuiet
                      onPress={() => {
                        setSelectedBranch(branch.name);
                        setDeleteDialogOpen(true);
                      }}
                      UNSAFE_className={css({
                        marginStart: tokenSchema.size.space.regular,
                      })}
                    >
                      <Icon src={trashIcon} />
                    </ActionButton>
                  )}
                </div>
              ))}
            </VStack>
          </div>,
          document.body,
        )}

      <DialogContainer onDismiss={() => setDeleteDialogOpen(false)}>
        {deleteDialogOpen && selectedBranch && (
          <AlertDialog
            title="Xoá branch?"
            tone="critical"
            cancelLabel="Hủy"
            primaryActionLabel="Xoá"
            autoFocusButton="cancel"
            onCancel={() => setDeleteDialogOpen(false)}
            onPrimaryAction={() => handleDeleteBranch(selectedBranch)}
          >
            <Text>Bạn chắc chắn muốn xoá branch <strong>{selectedBranch}</strong>?</Text>
          </AlertDialog>
        )}
      </DialogContainer>
    </>
  );
}
