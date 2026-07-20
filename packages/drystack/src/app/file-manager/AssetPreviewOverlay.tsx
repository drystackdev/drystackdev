import { useEffect, useRef, useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../l10n";
import { ActionButton, Button } from "@keystar/ui/button";
import { Icon } from "@keystar/ui/icon";
import { chevronLeftIcon } from "@keystar/ui/icon/icons/chevronLeftIcon";
import { chevronRightIcon } from "@keystar/ui/icon/icons/chevronRightIcon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { xIcon } from "@keystar/ui/icon/icons/xIcon";
import { zoomInIcon } from "@keystar/ui/icon/icons/zoomInIcon";
import { zoomOutIcon } from "@keystar/ui/icon/icons/zoomOutIcon";
import { Flex } from "@keystar/ui/layout";
import { tokenSchema } from "@keystar/ui/style";
import { Text } from "@keystar/ui/typography";

import {
  useMediaLibraryPrefetch,
  useMediaLibraryPreviewURL,
} from "../media-library/useMediaLibraryPreviewURL";
import { getHighlightLanguage, isImagePath } from "./file-kind";
import { highlightCode } from "./highlightCode";
import { useFileTextContent } from "./useFileTextContent";
import { useInView } from "./useInView";

const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const ZOOM_STEP = 10;

// translucent circular chrome so the nav arrows stay legible over any photo,
// light or dark - these float on top of the image itself, not the app chrome
const navButtonStyle = {
  backgroundColor: "rgba(0, 0, 0, 0.45)",
  color: "#fff",
  borderRadius: 999,
  height: 44,
  minWidth: 44,
} as const;

const zoomInputStyle = {
  width: 64,
  height: tokenSchema.size.element.regular,
  paddingInlineStart: tokenSchema.size.space.regular,
  paddingInlineEnd: 22,
  textAlign: "center" as const,
  borderRadius: tokenSchema.size.radius.regular,
  border: `${tokenSchema.size.border.regular} solid ${tokenSchema.color.alias.borderIdle}`,
  backgroundColor: tokenSchema.color.alias.backgroundIdle,
  color: tokenSchema.color.alias.foregroundIdle,
};

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function AssetPreviewOverlay(props: {
  path: string;
  siblings: string[];
  onNavigate: (path: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { path, siblings, onNavigate, onDelete, onClose } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const filename = path.split("/").pop()!;
  const isImage = isImagePath(path);
  const highlightLang = getHighlightLanguage(path);
  const objectUrl = useMediaLibraryPreviewURL(isImage ? path : null);
  const textContent = useFileTextContent(isImage ? null : path);

  const [zoom, setZoomRaw] = useState(100);
  const [zoomInput, setZoomInput] = useState("100");
  const stageRef = useRef<HTMLDivElement | null>(null);

  const index = siblings.indexOf(path);
  const canLoop = siblings.length > 1;
  const canPrev = canLoop;
  const canNext = canLoop;

  // Warm the full-res blobs on either side so left/right navigation is
  // instant. Siblings passed to the overlay are already filtered to images.
  useMediaLibraryPrefetch(
    isImage && canLoop && index >= 0
      ? [
          siblings[(index - 1 + siblings.length) % siblings.length],
          siblings[(index + 1) % siblings.length],
        ]
      : [],
  );

  function prevPath() {
    if (index < 0) return undefined;
    return siblings[(index - 1 + siblings.length) % siblings.length];
  }

  function nextPath() {
    if (index < 0) return undefined;
    return siblings[(index + 1) % siblings.length];
  }

  function setZoom(updater: number | ((current: number) => number)) {
    setZoomRaw((prev) => {
      const next = clampZoom(
        Math.round(typeof updater === "function" ? updater(prev) : updater),
      );
      setZoomInput(String(next));
      return next;
    });
  }

  function commitZoomInput() {
    const parsed = Number(zoomInput);
    if (Number.isFinite(parsed) && parsed > 0) setZoom(parsed);
    else setZoomInput(String(zoom));
  }

  function goTo(target: string | undefined) {
    if (!target) return;
    setZoom(100);
    onNavigate(target);
  }

  // mouse-wheel zoom - attached as a native, non-passive listener so
  // `preventDefault` actually stops the page from scrolling while zooming.
  // Only wired up for images - text previews need normal scroll-to-read.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !isImage) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      setZoom((z) => z + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [isImage]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (isTyping) return;
      if (event.key === "ArrowLeft" && canPrev) goTo(prevPath());
      else if (event.key === "ArrowRight" && canNext) goTo(nextPath());
      else if (isImage && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        setZoom((z) => z + ZOOM_STEP);
      } else if (isImage && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        setZoom((z) => z - ZOOM_STEP);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, siblings, isImage]);

  return (
    <Flex
      direction="column"
      backgroundColor="canvas"
      UNSAFE_style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
      }}
    >
      <Flex
        alignItems={{ mobile: "flex-end", tablet: "center" }}
        justifyContent="space-between"
        gap="regular"
        borderBottom="muted"
        direction={{ mobile: "column", tablet: "row" }}
        UNSAFE_style={{ padding: 12, flexShrink: 0 }}
      >
        <Flex
          alignItems="center"
          gap="regular"
          UNSAFE_style={{ minWidth: 0, maxWidth: "100%" }}
        >
          <ActionButton aria-label={stringFormatter.format("close")} onPress={onClose}>
            <Icon src={xIcon} />
          </ActionButton>
          <Text
            UNSAFE_style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: "1.5rem",
            }}
          >
            {filename}
          </Text>
        </Flex>

        <Flex alignItems="center" gap="regular">
          {isImage && (
            <Flex alignItems="center" gap="small">
              <ActionButton
                aria-label={stringFormatter.format("zoomOutAriaLabel")}
                isDisabled={zoom <= MIN_ZOOM}
                onPress={() => setZoom((z) => z - ZOOM_STEP)}
              >
                <Icon src={zoomOutIcon} />
              </ActionButton>
              <div style={{ position: "relative", display: "inline-flex" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={stringFormatter.format("zoomPercentageAriaLabel")}
                  value={zoomInput}
                  onChange={(event) =>
                    setZoomInput(event.target.value.replace(/[^\d]/g, ""))
                  }
                  onBlur={commitZoomInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  style={zoomInputStyle}
                />
                <Text
                  UNSAFE_style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none",
                    opacity: 0.7,
                  }}
                >
                  %
                </Text>
              </div>
              <ActionButton
                aria-label={stringFormatter.format("zoomInAriaLabel")}
                isDisabled={zoom >= MAX_ZOOM}
                onPress={() => setZoom((z) => z + ZOOM_STEP)}
              >
                <Icon src={zoomInIcon} />
              </ActionButton>
            </Flex>
          )}
          {onDelete && (
            <Button tone="critical" onPress={onDelete}>
              <Icon src={trash2Icon} />
              <Text>{stringFormatter.format("deleteAction")}</Text>
            </Button>
          )}
        </Flex>
      </Flex>

      <Flex
        ref={stageRef}
        flex={1}
        alignItems="center"
        justifyContent="center"
        UNSAFE_style={{ position: "relative", minHeight: 0, overflow: "auto" }}
      >
        {canPrev && (
          <ActionButton
            aria-label={stringFormatter.format("previousImageAriaLabel")}
            onPress={() => goTo(prevPath())}
            UNSAFE_style={{
              ...navButtonStyle,
              position: "absolute",
              left: 16,
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            <Icon src={chevronLeftIcon} />
          </ActionButton>
        )}
        {canNext && (
          <ActionButton
            aria-label={stringFormatter.format("nextImageAriaLabel")}
            onPress={() => goTo(nextPath())}
            UNSAFE_style={{
              ...navButtonStyle,
              position: "absolute",
              right: 16,
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            <Icon src={chevronRightIcon} />
          </ActionButton>
        )}

        {isImage
          ? objectUrl && (
              <img
                src={objectUrl}
                alt=""
                draggable={false}
                style={{
                  display: "block",
                  maxWidth: "85vw",
                  maxHeight: "75vh",
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: "center",
                }}
              />
            )
          : textContent != null && (
              <pre
                style={{
                  margin: 0,
                  padding: 16,
                  maxWidth: "85vw",
                  maxHeight: "75vh",
                  overflow: "auto",
                  textAlign: "left",
                  fontFamily: "monospace",
                  fontSize: 13,
                  lineHeight: 1.6,
                  backgroundColor: tokenSchema.color.background.surface,
                  border: `${tokenSchema.size.border.regular} solid ${tokenSchema.color.alias.borderIdle}`,
                  borderRadius: tokenSchema.size.radius.regular,
                }}
              >
                <code>
                  {highlightLang
                    ? highlightCode(textContent, highlightLang)
                    : textContent}
                </code>
              </pre>
            )}
      </Flex>

      {siblings.length > 1 && (
        <Flex
          gap="small"
          justifyContent="center"
          borderTop="muted"
          UNSAFE_style={{
            padding: 12,
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {siblings.map((siblingPath) => (
            <FilmstripThumb
              key={siblingPath}
              path={siblingPath}
              isActive={siblingPath === path}
              onSelect={() => goTo(siblingPath)}
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}

function FilmstripThumb(props: {
  path: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [ref, inView] = useInView<HTMLButtonElement>();
  const url = useMediaLibraryPreviewURL(props.path, undefined, inView, true);
  const name = props.path.split("/").pop();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  return (
    <ActionButton
      ref={ref}
      aria-label={stringFormatter.format("showAssetAriaLabel", {
        name: name ?? "",
      })}
      onPress={props.onSelect}
      UNSAFE_style={{
        height: "unset",
        padding: 2,
        flexShrink: 0,
        border: `2px solid ${
          props.isActive
            ? tokenSchema.color.alias.borderSelected
            : "transparent"
        }`,
        borderRadius: 6,
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            display: "block",
            width: 64,
            height: 64,
            objectFit: "cover",
            borderRadius: 3,
          }}
        />
      ) : (
        <div style={{ width: 64, height: 64 }} />
      )}
    </ActionButton>
  );
}
