import { useState } from "react";
import { ActionButton } from "@keystar/ui/button";
import { Checkbox } from "@keystar/ui/checkbox";
import { Icon } from "@keystar/ui/icon";
import { fileCodeIcon } from "@keystar/ui/icon/icons/fileCodeIcon";
import { folderClosedIcon } from "#icons/folderClosedIcon";
import { imageIcon } from "#icons/imageIcon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { rotateCcwIcon } from "@keystar/ui/icon/icons/rotateCcwIcon";
import { Flex } from "@keystar/ui/layout";
import { Text } from "@keystar/ui/typography";
import { getFileTypeLabel } from "./file-kind";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";

import { useMediaLibraryPreviewURL } from "../media-library/useMediaLibraryPreviewURL";
import { useInView } from "./useInView";

export type AssetListItemProps = {
  name: string;
  kind: "folder" | "file";
  path?: string;
  isImage?: boolean;
  // bytes for a file uploaded/picked this session, not yet in the tree -
  // lets the thumbnail render immediately instead of waiting on a tree
  // refresh (see useMediaLibraryPreviewURL)
  previewContent?: Uint8Array;
  childCount?: number;
  size?: number | null;
  selectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onOpen: () => void;
  disabled?: boolean;
};

export function AssetListItem(props: AssetListItemProps) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const previewUrl = useMediaLibraryPreviewURL(
    props.kind === "file" && props.isImage && props.path ? props.path : null,
    props.previewContent,
    inView,
    true, // list thumbnail - a downscaled preview is plenty
  );

  const typeText =
    props.kind === "folder" ? "Folder" : getFileTypeLabel(props.name);

  return (
    <Flex
      ref={ref}
      alignItems="center"
      gap="small"
      padding="medium"
      backgroundColor="canvas"
      border="neutral"
      borderRadius="regular"
      UNSAFE_style={{
        opacity: props.disabled ? 0.45 : undefined,
        cursor: !props.disabled ? "pointer" : undefined,
        gap: "1rem",
      }}
      onClick={() => {
        if (!props.disabled) props.onOpen();
      }}
    >
      {!props.disabled && props.selectable && (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`Select ${props.name}`}
            isSelected={props.isSelected}
            onChange={props.onToggleSelect}
          />
        </div>
      )}

      <Flex
        alignItems="center"
        justifyContent="center"
        borderRadius="regular"
        UNSAFE_style={{
          minWidth: 48,
          width: 48,
          height: 48,
          flexShrink: 0,
          overflow: "hidden",
          backgroundColor: "var(--kui-color-alias-background-idle)",
        }}
      >
        {previewUrl && props.kind === "file" ? (
          <img
            src={previewUrl}
            alt=""
            style={{
              display: "block",
              maxHeight: "100%",
              maxWidth: "100%",
              objectFit: "contain",
              lineHeight: "48px",
            }}
          />
        ) : (
          <Icon
            src={
              props.kind === "folder"
                ? folderClosedIcon
                : props.isImage
                  ? imageIcon
                  : fileCodeIcon
            }
            size="regular"
          />
        )}
      </Flex>

      <Flex
        direction="column"
        gap="small"
        UNSAFE_style={{
          minWidth: 0,
          flex: 1,
        }}
      >
        <Text
          UNSAFE_style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 500,
            lineHeight: "2em",
          }}
        >
          {props.name}
        </Text>
      </Flex>

      <Text color="neutralSecondary" UNSAFE_style={{ minWidth: 80 }}>
        {typeText}
      </Text>

      {!props.disabled && (props.onDelete || props.onRestore) && (
        <Flex gap="small" onClick={(e) => e.stopPropagation()}>
          {props.onRestore && (
            <TooltipTrigger>
              <ActionButton aria-label="Restore" onPress={props.onRestore}>
                <Icon src={rotateCcwIcon} />
              </ActionButton>
              <Tooltip>Restore</Tooltip>
            </TooltipTrigger>
          )}
          {props.onDelete && (
            <TooltipTrigger>
              <ActionButton aria-label="Delete" onPress={props.onDelete}>
                <Icon src={trash2Icon} />
              </ActionButton>
              <Tooltip tone="critical">Delete</Tooltip>
            </TooltipTrigger>
          )}
        </Flex>
      )}
    </Flex>
  );
}
