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

export type AssetCardProps = {
  name: string;
  kind: "folder" | "file";
  // real tree path — only required when selectable/deletable
  path?: string;
  isImage?: boolean;
  // bytes for a file uploaded/picked this session, not yet in the tree —
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
  // shown dimmed and non-interactive — used for files excluded by a picker's
  // `accept` filter, which the plan wants visible-but-unselectable rather
  // than hidden entirely
  disabled?: boolean;
};

// translucent circular chrome so delete/restore icons stay legible over any
// thumbnail (light or dark image) instead of relying on ActionButton's
// default (transparent until hovered) styling
const overlayButtonStyle = {
  backgroundColor: "rgba(0, 0, 0, 0.55)",
  color: "#fff",
  borderRadius: 999,
} as const;

export function AssetCard(props: AssetCardProps) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const previewUrl = useMediaLibraryPreviewURL(
    props.kind === "file" && props.isImage && props.path ? props.path : null,
    props.previewContent,
    inView,
    true, // grid card — a downscaled thumbnail is plenty
  );
  const [isHovered, setIsHovered] = useState(false);

  const infoText =
    props.kind === "folder" ? "Folder" : getFileTypeLabel(props.name);
  // truncated filename gets an ellipsis — surface the full name + type as a
  // native tooltip so it's still discoverable on hover
  const fullLabel = `${props.name} — ${infoText}`;

  return (
    <Flex
      ref={ref}
      direction="column"
      gap="small"
      backgroundColor="canvas"
      border="neutral"
      borderRadius="regular"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      UNSAFE_style={{
        width: "100%",
        padding: 8,
        position: "relative",
        opacity: props.disabled ? 0.45 : undefined,
      }}
    >
      {!props.disabled && isHovered && (props.onDelete || props.onRestore) && (
        <Flex
          gap="small"
          UNSAFE_style={{ position: "absolute", top: 12, right: 12, zIndex: 1 }}
        >
          {props.onRestore && (
            <TooltipTrigger>
              <ActionButton
                aria-label="Restore"
                onPress={props.onRestore}
                UNSAFE_style={overlayButtonStyle}
              >
                <Icon src={rotateCcwIcon} />
              </ActionButton>
              <Tooltip>Restore</Tooltip>
            </TooltipTrigger>
          )}
          {props.onDelete && (
            <TooltipTrigger>
              <ActionButton
                aria-label="Delete"
                onPress={props.onDelete}
                UNSAFE_style={overlayButtonStyle}
              >
                <Icon src={trash2Icon} />
              </ActionButton>
              <Tooltip tone="critical">Delete</Tooltip>
            </TooltipTrigger>
          )}
        </Flex>
      )}
      <ActionButton
        aria-label={
          props.kind === "folder"
            ? `Open ${props.name}`
            : `Preview ${props.name}`
        }
        UNSAFE_style={{ height: "unset", padding: 0 }}
        isDisabled={props.disabled}
        onPress={props.onOpen}
      >
        <Flex
          alignItems="center"
          justifyContent="center"
          borderRadius="regular"
          UNSAFE_style={{ width: "100%", height: 110, overflow: "hidden" }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              style={{
                display: "block",
                maxHeight: "100%",
                maxWidth: "100%",
                objectFit: "contain",
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
              size="large"
            />
          )}
        </Flex>
      </ActionButton>
      <Flex alignItems="center">
        {!props.disabled && props.selectable && (
          <Checkbox
            aria-label={`Select ${props.name}`}
            isSelected={props.isSelected}
            onChange={props.onToggleSelect}
          />
        )}
        <Flex
          direction="column"
          gap="small"
          title={fullLabel}
          onClick={
            !props.disabled && props.selectable
              ? props.onToggleSelect
              : undefined
          }
          UNSAFE_style={{
            minWidth: 0,
            flex: 1,
            cursor: !props.disabled && props.selectable ? "pointer" : undefined,
          }}
        >
          <Text
            UNSAFE_style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: "1.5rem",
            }}
          >
            {props.name}
          </Text>
          <Text color="neutralSecondary">{infoText}</Text>
        </Flex>
      </Flex>
    </Flex>
  );
}
