import { setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { MarkType, NodeType } from "prosemirror-model";
import { Command, EditorState, TextSelection } from "prosemirror-state";
import { liftTarget } from "prosemirror-transform";
import {
  HTMLAttributes,
  ReactElement,
  ReactNode,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../app/l10n";

import { ActionButton } from "@keystar/ui/button";
import {
  EditorToolbar,
  EditorToolbarButton,
  EditorToolbarGroup,
  EditorToolbarItem,
  EditorToolbarSeparator,
} from "@keystar/ui/editor";
import { Icon } from "@keystar/ui/icon";
import { alignCenterIcon } from "@keystar/ui/icon/icons/alignCenterIcon";
import { alignJustifyIcon } from "@keystar/ui/icon/icons/alignJustifyIcon";
import { alignLeftIcon } from "@keystar/ui/icon/icons/alignLeftIcon";
import { alignRightIcon } from "@keystar/ui/icon/icons/alignRightIcon";
import { boldIcon } from "@keystar/ui/icon/icons/boldIcon";
import { chevronDownIcon } from "@keystar/ui/icon/icons/chevronDownIcon";
import { codeIcon } from "@keystar/ui/icon/icons/codeIcon";
import { italicIcon } from "@keystar/ui/icon/icons/italicIcon";
import { listIcon } from "@keystar/ui/icon/icons/listIcon";
import { listOrderedIcon } from "@keystar/ui/icon/icons/listOrderedIcon";
import { minusIcon } from "@keystar/ui/icon/icons/minusIcon";
import { plusIcon } from "@keystar/ui/icon/icons/plusIcon";
import { quoteIcon } from "@keystar/ui/icon/icons/quoteIcon";
import { removeFormattingIcon } from "@keystar/ui/icon/icons/removeFormattingIcon";
import { strikethroughIcon } from "@keystar/ui/icon/icons/strikethroughIcon";
import { tableIcon } from "@keystar/ui/icon/icons/tableIcon";
import { columnsIcon } from "@keystar/ui/icon/icons/columnsIcon";
import { underlineIcon } from "@keystar/ui/icon/icons/underlineIcon";
import { MenuTrigger, Menu } from "@keystar/ui/menu";
import { Picker, Item } from "@keystar/ui/picker";
import { breakpointQueries, css, tokenSchema } from "@keystar/ui/style";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Text, Kbd } from "@keystar/ui/typography";

import {
  useEditorDispatchCommand,
  useEditorSchema,
  useEditorState,
  useEditorViewRef,
} from "./editor-view";
import { toggleList } from "./lists";
import { insertNode, insertTable, toggleCodeBlock } from "./commands/misc";
import { insertGrid } from "./grid";
import { EditorSchema, FONT_SIZE_VALUES, FontSizeKey } from "./schema";
import { ImageToolbarButton } from "./images";
import { ContentRefToolbarButton } from "./content-ref";
import { useEntryLayoutSplitPaneContext } from "../../../../app/entry-form";
import { itemRenderer } from "./autocomplete/insert-menu";
import { LinkDialog } from "./popovers/link-toolbar";
import { TextColorDialog } from "./popovers/text-color-dialog";
import { DialogContainer } from "@keystar/ui/dialog";
import { linkIcon } from "@keystar/ui/icon/icons/linkIcon";
import { markAround } from "./popovers";
import { useEditorKeydownListener } from "./keydown";
import { gridInsertIcon } from "#icons/gridInsertIcon";
import { textColorIcon } from "#icons/textColorIcon";
import { ContentToolbarAiButton } from "../../../../app/ai/ContentToolbarAiButton";

function Noop() {
  return null;
}

export function ToolbarButton(props: {
  children: ReactNode;
  "aria-label": string;
  isSelected?: (editorState: EditorState) => boolean;
  isDisabled?: (editorState: EditorState) => boolean;
  command: Command;
}) {
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const isSelected = !!props.isSelected?.(state); // no `undefined` - stop "uncontrolled" state taking over
  const isDisabled = !props.command(state) || props.isDisabled?.(state);
  return useMemo(
    () => (
      <EditorToolbarButton
        aria-label={props["aria-label"]}
        isSelected={isSelected}
        isDisabled={isDisabled}
        onPress={() => {
          runCommand(props.command);
        }}
      >
        {props.children}
      </EditorToolbarButton>
    ),
    [isDisabled, isSelected, props, runCommand],
  );
}

function LinkButton(props: { link: MarkType }) {
  const [text, setText] = useState<null | string>(null);
  const runCommand = useEditorDispatchCommand();
  const viewRef = useEditorViewRef();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  useEditorKeydownListener((event) => {
    if (event.metaKey && (event.key === "k" || event.key === "K")) {
      const { state } = viewRef.current!;
      if (!isMarkActive(props.link)(state)) {
        event.preventDefault();
        setText(
          state.doc.textBetween(state.selection.from, state.selection.to),
        );
        return true;
      }
    }
    return false;
  });
  return useMemo(
    () => (
      <>
        <TooltipTrigger>
          <ToolbarButton
            aria-label={stringFormatter.format("toolbarDivider")}
            command={(state, dispatch) => {
              const aroundFrom = markAround(state.selection.$from, props.link);
              const aroundTo = markAround(state.selection.$to, props.link);
              if (
                aroundFrom &&
                (!aroundTo || aroundFrom.mark === aroundTo?.mark)
              ) {
                if (dispatch) {
                  dispatch(
                    state.tr.removeMark(
                      aroundFrom.from,
                      aroundTo?.to ?? aroundFrom.to,
                      props.link,
                    ),
                  );
                }
                return true;
              }
              if (state.selection.empty) {
                return false;
              }
              if (dispatch) {
                const text = state.doc.textBetween(
                  state.selection.from,
                  state.selection.to,
                );
                setText(text);
              }
              return true;
            }}
            isSelected={isMarkActive(props.link)}
          >
            <Icon src={linkIcon} />
          </ToolbarButton>
          <Tooltip>
            <Text>{stringFormatter.format("editorLinkTooltip")}</Text>
            <Kbd meta>K</Kbd>
          </Tooltip>
        </TooltipTrigger>
        <DialogContainer
          onDismiss={() => {
            setText(null);
          }}
        >
          {text && (
            <LinkDialog
              href=""
              text={text}
              onSubmit={(attrs) => {
                setText(null);
                runCommand(toggleMark(props.link, attrs));
              }}
            />
          )}
        </DialogContainer>
      </>
    ),
    [props.link, runCommand, text, stringFormatter],
  );
}

// With a selection, the range is the selection itself. With just a cursor,
// fall back to the boundaries of the color run it sits in (mirroring how
// LinkButton uses markAround) so the toolbar reflects - and can edit or
// remove - a color the cursor is resting inside without requiring the user
// to select it first.
function textColorRange(
  state: EditorState,
  textColor: MarkType,
): { from: number; to: number } | null {
  const { from, to, empty } = state.selection;
  if (!empty) return { from, to };
  const around = markAround(state.selection.$from, textColor);
  return around && { from: around.from, to: around.to };
}

function getTextColorState(
  state: EditorState,
  textColor: MarkType,
): { isDisabled: boolean; value: string | undefined; mixed: boolean } {
  const range = textColorRange(state, textColor);
  if (!range) return { isDisabled: true, value: undefined, mixed: false };
  // "" stands in for "no mark on this run" (fontSize's equivalent default is
  // "medium") so a real `undefined` is reserved purely for "nothing scanned
  // yet" - conflating the two would make a colored run following plain runs
  // look non-mixed.
  let selected: string | undefined;
  let mixed = false;
  state.doc.nodesBetween(range.from, range.to, (node) => {
    if (!node.isText) return;
    const mark = textColor.isInSet(node.marks);
    const value = (mark?.attrs.value as string | undefined) ?? "";
    if (selected === undefined) selected = value;
    else if (selected !== value) mixed = true;
  });
  return { isDisabled: false, value: mixed ? undefined : selected || undefined, mixed };
}

function setTextColor(textColor: MarkType, value: string | null): Command {
  return (state, dispatch) => {
    const range = textColorRange(state, textColor);
    if (!range) return false;
    if (dispatch) {
      let tr = state.tr.removeMark(range.from, range.to, textColor);
      if (value) tr = tr.addMark(range.from, range.to, textColor.create({ value }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function TextColorButton(props: { textColor: MarkType }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { isDisabled, value, mixed } = getTextColorState(state, props.textColor);
  return useMemo(
    () => (
      <>
        <TooltipTrigger>
          <EditorToolbarButton
            aria-label={stringFormatter.format("editorTextColor")}
            isDisabled={isDisabled}
            isSelected={!!value}
            onPress={() => setDialogOpen(true)}
          >
            <Icon src={textColorIcon(mixed ? undefined : value)} />
          </EditorToolbarButton>
          <Tooltip>
            <Text>{stringFormatter.format("editorTextColor")}</Text>
          </Tooltip>
        </TooltipTrigger>
        <DialogContainer onDismiss={() => setDialogOpen(false)}>
          {dialogOpen && (
            <TextColorDialog
              initialValue={value}
              mixed={mixed}
              onSubmit={(next) => {
                runCommand(setTextColor(props.textColor, next));
              }}
            />
          )}
        </DialogContainer>
      </>
    ),
    [isDisabled, value, mixed, props.textColor, runCommand, dialogOpen, stringFormatter],
  );
}

export const Toolbar = memo(function Toolbar(
  props: HTMLAttributes<HTMLDivElement>,
) {
  const schema = useEditorSchema();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { nodes, marks, config } = schema;
  // An inline-only field (config.inlineOnly, e.g. a bold-only heading) never
  // shows more than one button group - lists/blocks/alignment all disappear
  // from the schema - so the separators around them would otherwise stack up
  // next to each other with nothing between them.
  const Separator = config.inlineOnly ? Noop : EditorToolbarSeparator;
  return (
    <ToolbarWrapper {...props}>
      <ToolbarScrollArea>
        {nodes.heading && <HeadingMenu headingType={nodes.heading} />}
        <EditorToolbar aria-label={stringFormatter.format("editorFormattingOptions")}>
          <Separator />
          <InlineMarks />
          {config.htmlLayout && (
            <>
              <AlignmentControls />
              <Separator />
            </>
          )}
          {nodes.image && <ImageToolbarButton />}
          {nodes.content_ref && <ContentRefToolbarButton />}
          {marks.fontSize && <FontSizeMenu fontSize={marks.fontSize} />}
          <Separator />
          <ListButtons />
          <Separator />
          <EditorToolbarGroup aria-label={stringFormatter.format("editorBlocksGroup")}>
            {nodes.divider && (
              <TooltipTrigger>
                <ToolbarButton
                  aria-label={stringFormatter.format("toolbarDivider")}
                  command={insertNode(nodes.divider)}
                  isSelected={typeInSelection(nodes.divider)}
                >
                  <Icon src={minusIcon} />
                </ToolbarButton>
                <Tooltip>
                  <Text>{stringFormatter.format("toolbarDivider")}</Text>
                  <Kbd>---</Kbd>
                </Tooltip>
              </TooltipTrigger>
            )}
            {marks.link && <LinkButton link={marks.link} />}
            {nodes.blockquote && (
              <TooltipTrigger>
                <ToolbarButton
                  aria-label={stringFormatter.format("editorQuote")}
                  command={(state, dispatch) => {
                    const hasQuote = typeInSelection(nodes.blockquote!)(state);
                    if (hasQuote) {
                      const { $from, $to } = state.selection;
                      const range = $from.blockRange(
                        $to,
                        (node) => node.type === nodes.blockquote,
                      );
                      if (!range) return false;
                      const target = liftTarget(range);
                      if (target === null) return false;
                      if (dispatch) {
                        dispatch(state.tr.lift(range, target).scrollIntoView());
                      }
                      return true;
                    } else {
                      return wrapIn(nodes.blockquote!)(state, dispatch);
                    }
                  }}
                  isSelected={typeInSelection(nodes.blockquote)}
                >
                  <Icon src={quoteIcon} />
                </ToolbarButton>
                <Tooltip>
                  <Text>{stringFormatter.format("editorQuote")}</Text>
                  <Kbd>{">⎵"}</Kbd>
                </Tooltip>
              </TooltipTrigger>
            )}
            {nodes.code_block && (
              <TooltipTrigger>
                <ToolbarButton
                  aria-label={stringFormatter.format("editorCodeBlock")}
                  command={toggleCodeBlock(nodes.code_block, nodes.paragraph!)}
                  isSelected={typeInSelection(nodes.code_block)}
                >
                  <Icon src={codeIcon} />
                </ToolbarButton>
                <Tooltip>
                  <Text>{stringFormatter.format("editorCodeBlock")}</Text>
                  <Kbd>```</Kbd>
                </Tooltip>
              </TooltipTrigger>
            )}
            {nodes.table && (
              <TooltipTrigger>
                <ToolbarButton
                  aria-label={stringFormatter.format("editorTable")}
                  command={insertTable(nodes.table)}
                >
                  <Icon src={tableIcon} />
                </ToolbarButton>
                <Tooltip>
                  <Text>{stringFormatter.format("editorTable")}</Text>
                </Tooltip>
              </TooltipTrigger>
            )}
            {nodes.grid && (
              <TooltipTrigger>
                <ToolbarButton
                  aria-label={stringFormatter.format("editorGrid")}
                  command={insertGrid(nodes.grid)}
                >
                  <Icon src={gridInsertIcon} />
                </ToolbarButton>
                <Tooltip>
                  <Text>{stringFormatter.format("editorGrid")}</Text>
                </Tooltip>
              </TooltipTrigger>
            )}
          </EditorToolbarGroup>
        </EditorToolbar>
      </ToolbarScrollArea>

      <ContentToolbarAiButton />
      <InsertBlockMenu />
    </ToolbarWrapper>
  );
});

const ToolbarContainer = ({ children }: { children: ReactNode }) => {
  let entryLayoutPane = useEntryLayoutSplitPaneContext();
  return (
    <div
      data-layout={entryLayoutPane}
      className={css({
        alignItems: "center",
        boxSizing: "border-box",
        display: "flex",
        height: tokenSchema.size.element.medium,

        [breakpointQueries.above.mobile]: {
          height: tokenSchema.size.element.large,
        },

        '&[data-layout="main"]': {
          marginInline: "auto",
          maxWidth: 800,
          minWidth: 0,
          paddingInline: tokenSchema.size.space.medium,
          [breakpointQueries.above.mobile]: {
            paddingInline: tokenSchema.size.space.xlarge,
          },
          [breakpointQueries.above.tablet]: {
            paddingInline: tokenSchema.size.space.xxlarge,
          },
        },
      })}
    >
      {children}
    </div>
  );
};

const ToolbarWrapper = (props: HTMLAttributes<HTMLDivElement>) => {
  let entryLayoutPane = useEntryLayoutSplitPaneContext();
  return (
    <div
      {...props}
      data-layout={entryLayoutPane}
      className={css({
        backdropFilter: "blur(8px)",
        backgroundClip: "padding-box",
        backgroundColor: `color-mix(in srgb, transparent, ${tokenSchema.color.background.canvas} 90%)`,
        borderBottom: `${tokenSchema.size.border.regular} solid color-mix(in srgb, transparent, ${tokenSchema.color.foreground.neutral} 10%)`,
        borderStartEndRadius: tokenSchema.size.radius.medium,
        borderStartStartRadius: tokenSchema.size.radius.medium,
        minWidth: 0,
        position: "sticky",
        top: 0,
        zIndex: 2,

        '&[data-layout="main"]': { borderRadius: 0 },
      })}
    >
      <ToolbarContainer>{props.children}</ToolbarContainer>
    </div>
  );
};

const ToolbarScrollArea = (props: { children: ReactNode }) => {
  let entryLayoutPane = useEntryLayoutSplitPaneContext();
  // Mutable, not state - drag position updates on every pointer move and
  // shouldn't trigger a re-render of the whole toolbar.
  const drag = useRef({
    dragging: false,
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
    moved: false,
  });
  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // React attaches `onWheel` as a passive listener, so its
    // `event.preventDefault()` can't actually stop the page from also
    // scrolling vertically - a real, non-passive listener is required to
    // contain the gesture inside the toolbar.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || event.deltaY === 0) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div
      ref={elRef}
      data-layout={entryLayoutPane}
      className={css({
        alignItems: "center",
        display: "flex",
        flex: 1,
        gap: tokenSchema.size.space.regular,
        paddingInline: tokenSchema.size.space.medium,
        minWidth: 0,
        overflowX: "auto",

        // avoid cropping focus rings
        marginBlock: `calc(${tokenSchema.size.alias.focusRing} * -1)`,
        paddingBlock: tokenSchema.size.alias.focusRing,

        // hide scrollbars
        msOverflowStyle: "none", // for Internet Explorer, Edge
        scrollbarWidth: "none", // for Firefox
        "&::-webkit-scrollbar": { display: "none" }, // for Chrome, Safari, and Opera

        '&[data-layout="main"]': {
          paddingInline: 0,
        },
      })}
      // Capture phase, not bubble - the toolbar is almost entirely covered
      // by buttons/pickers whose own press handling stops propagation, so a
      // bubble-phase listener here would only ever see drags starting in
      // the few pixels of gap between them. Capture runs before that.
      onPointerDownCapture={(event) => {
        const el = event.currentTarget;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (el.scrollWidth <= el.clientWidth) return;
        drag.current = {
          dragging: true,
          pointerId: event.pointerId,
          startX: event.clientX,
          scrollLeft: el.scrollLeft,
          moved: false,
        };
      }}
      onPointerMoveCapture={(event) => {
        const state = drag.current;
        if (!state.dragging || event.pointerId !== state.pointerId) return;
        const delta = event.clientX - state.startX;
        if (!state.moved) {
          if (Math.abs(delta) < 5) return;
          state.moved = true;
          event.currentTarget.style.cursor = "grabbing";
          // Once the drag threshold is crossed, capture the pointer so
          // moves/up keep reaching this element even when the cursor
          // strays over a button or outside the toolbar's own bounds.
          event.currentTarget.setPointerCapture(state.pointerId);
        }
        event.preventDefault();
        event.currentTarget.scrollLeft = state.scrollLeft - delta;
      }}
      onPointerUpCapture={(event) => {
        if (event.pointerId !== drag.current.pointerId) return;
        drag.current.dragging = false;
        event.currentTarget.style.cursor = "";
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancelCapture={(event) => {
        if (event.pointerId !== drag.current.pointerId) return;
        drag.current.dragging = false;
        event.currentTarget.style.cursor = "";
      }}
      onClickCapture={(event) => {
        // A drag that ends over a button would otherwise also fire that
        // button's click - swallow it once per drag.
        if (drag.current.moved) {
          event.preventDefault();
          event.stopPropagation();
          drag.current.moved = false;
        }
      }}
      {...props}
    />
  );
};
type HeadingState = "normal" | 1 | 2 | 3 | 4 | 5 | 6;
const headingMenuVals = new Map<string | number, HeadingState>([
  ["normal", "normal"],
  ["1", 1],
  ["2", 2],
  ["3", 3],
  ["4", 4],
  ["5", 5],
  ["6", 6],
]);

type HeadingItem = { name: string; id: string | number };

function getHeadingMenuState(
  state: EditorState,
  headingType: NodeType,
  paragraphType: NodeType,
): HeadingState | "disabled" {
  let activeLevel: HeadingState | "disabled" | undefined;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (node.type === headingType) {
        const level = node.attrs.level;
        if (activeLevel === undefined) {
          activeLevel = level;
        } else if (activeLevel !== level) {
          activeLevel = "disabled";
        }
      }
      if (node.type === paragraphType) {
        if (activeLevel === undefined) {
          activeLevel = "normal";
        } else if (activeLevel !== "normal") {
          activeLevel = "disabled";
        }
      }
    });
    if (activeLevel === "disabled") {
      break;
    }
  }
  return activeLevel ?? "disabled";
}

const HeadingMenu = (props: { headingType: NodeType }) => {
  const { nodes, config } = useEditorSchema();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const items = useMemo(() => {
    let resolvedItems: HeadingItem[] = [
      { name: stringFormatter.format("editorParagraph"), id: "normal" },
    ];
    config.heading.levels.forEach((level) => {
      resolvedItems.push({
        name: stringFormatter.format("editorHeadingLevel", { level }),
        id: level.toString(),
      });
    });
    return resolvedItems;
  }, [config.heading.levels, stringFormatter]);
  const state = useEditorState();
  const menuState = getHeadingMenuState(
    state,
    props.headingType,
    nodes.paragraph!,
  );
  const runCommand = useEditorDispatchCommand();

  return useMemo(
    () => (
      <Picker
        flexShrink={0}
        width="scale.1700"
        prominence="low"
        aria-label={stringFormatter.format("editorTextBlock")}
        items={items}
        isDisabled={menuState === "disabled"}
        selectedKey={menuState === "disabled" ? "normal" : menuState.toString()}
        onSelectionChange={(selected) => {
          let key = headingMenuVals.get(selected!);
          if (key === "normal") {
            runCommand(setBlockType(nodes.paragraph!));
          } else if (key) {
            runCommand(
              setBlockType(props.headingType, {
                level: parseInt(key as any),
              }),
            );
          }
        }}
      >
        {(item) => <Item key={item.id}>{item.name}</Item>}
      </Picker>
    ),
    [items, menuState, nodes.paragraph, props.headingType, runCommand],
  );
};

type FontSizeValue = FontSizeKey | "medium";

function getFontSizeItems(
  stringFormatter: ReturnType<typeof useLocalizedStringFormatter>,
): { key: FontSizeValue; label: string }[] {
  return [
    { key: "xx-small", label: stringFormatter.format("editorFontSize2XSmall") },
    { key: "x-small", label: stringFormatter.format("editorFontSizeXSmall") },
    { key: "small", label: stringFormatter.format("editorFontSizeSmall") },
    { key: "medium", label: stringFormatter.format("editorFontSizeMedium") },
    { key: "large", label: stringFormatter.format("editorFontSizeLarge") },
    { key: "x-large", label: stringFormatter.format("editorFontSizeXLarge") },
    { key: "xx-large", label: stringFormatter.format("editorFontSize2XLarge") },
    { key: "xxx-large", label: stringFormatter.format("editorFontSize3XLarge") },
  ];
}

// With no selection, font size applies to the whole block the cursor sits
// in - except inside a table or grid, where it applies to the entire
// table/grid rather than just the current cell. Walking outward from the
// cursor and stopping at the first table/grid ancestor (before falling back
// to the innermost block) gives exactly that priority.
function fontSizeBlockRange(
  state: EditorState,
): { from: number; to: number } | null {
  const $pos = state.selection.$from;
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table" || node.type.name === "grid") {
      return { from: $pos.start(d), to: $pos.end(d) };
    }
  }
  if ($pos.depth === 0) return null;
  return { from: $pos.start($pos.depth), to: $pos.end($pos.depth) };
}

function fontSizeRange(
  state: EditorState,
): { from: number; to: number } | null {
  const { from, to, empty } = state.selection;
  if (!empty) return { from, to };
  return fontSizeBlockRange(state);
}

function getFontSizeState(
  state: EditorState,
  fontSize: MarkType,
): { isDisabled: boolean; selected: FontSizeValue | null } {
  const range = fontSizeRange(state);
  if (!range || range.from === range.to) {
    return { isDisabled: true, selected: null };
  }
  let selected: FontSizeValue | undefined;
  let mixed = false;
  state.doc.nodesBetween(range.from, range.to, (node) => {
    if (!node.isText) return;
    const mark = fontSize.isInSet(node.marks);
    const value = ((mark?.attrs.size as FontSizeValue) ?? "medium") as FontSizeValue;
    if (selected === undefined) selected = value;
    else if (selected !== value) mixed = true;
  });
  if (selected === undefined) return { isDisabled: true, selected: null };
  return { isDisabled: false, selected: mixed ? null : selected };
}

function setFontSize(fontSize: MarkType, value: FontSizeValue): Command {
  return (state, dispatch) => {
    const range = fontSizeRange(state);
    if (!range || range.from === range.to) return false;
    if (dispatch) {
      let tr = state.tr.removeMark(range.from, range.to, fontSize);
      if (value !== "medium") {
        tr = tr.addMark(range.from, range.to, fontSize.create({ size: value }));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function FontSizeMenu(props: { fontSize: MarkType }) {
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { isDisabled, selected } = getFontSizeState(state, props.fontSize);
  const current = selected ?? "medium";
  const items = useMemo(
    () => getFontSizeItems(stringFormatter),
    [stringFormatter],
  );

  return useMemo(
    () => (
      <Picker
        flexShrink={0}
        width="scale.1700"
        prominence="low"
        aria-label={stringFormatter.format("editorFontSize")}
        items={items}
        isDisabled={isDisabled}
        selectedKey={current}
        onSelectionChange={(key) => {
          runCommand(setFontSize(props.fontSize, key as FontSizeValue));
        }}
      >
        {(item) => <Item key={item.key}>{item.label}</Item>}
      </Picker>
    ),
    [isDisabled, current, props.fontSize, runCommand, items, stringFormatter],
  );
}

function InsertBlockMenu() {
  const entryLayoutPane = useEntryLayoutSplitPaneContext();

  const commandDispatch = useEditorDispatchCommand();
  const schema = useEditorSchema();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const items = useMemo(
    () => schema.insertMenuItems.filter((x) => x.forToolbar),
    [schema.insertMenuItems],
  );
  const idToItem = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <MenuTrigger align="end">
      <TooltipTrigger>
        <ActionButton
          marginEnd={entryLayoutPane === "main" ? undefined : "medium"}
        >
          <Icon src={plusIcon} />
          <Icon src={chevronDownIcon} />
        </ActionButton>
        <Tooltip>
          <Text>{stringFormatter.format("editorInsert")}</Text>
          <Kbd>/</Kbd>
        </Tooltip>
      </TooltipTrigger>
      <Menu
        onAction={(id) => {
          const command = idToItem.get(id as string)?.command;
          if (command) {
            commandDispatch(command);
          }
        }}
        items={items}
      >
        {itemRenderer}
      </Menu>
    </MenuTrigger>
  );
}

const isMarkActive = (markType: MarkType) => (state: EditorState) => {
  if (state.selection instanceof TextSelection && state.selection.empty) {
    if (!state.selection.$cursor) return false;
    return !!markType.isInSet(
      state.storedMarks || state.selection.$cursor.marks(),
    );
  }
  for (const range of state.selection.ranges) {
    if (state.doc.rangeHasMark(range.$from.pos, range.$to.pos, markType)) {
      return true;
    }
  }
  return false;
};

function InlineMarks() {
  const state = useEditorState();
  const schema = useEditorSchema();
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { inlineMarks, textColorInsertIndex } = useMemo(() => {
    const marks: {
      key: string;
      label: string;
      icon: ReactElement;
      shortcut?: string;
      command: Command;
      isSelected: (state: EditorState) => boolean;
    }[] = [];
    if (schema.marks.bold) {
      marks.push({
        key: "bold",
        label: stringFormatter.format("editorBold"),
        icon: boldIcon,
        shortcut: `B`,
        command: toggleMark(schema.marks.bold),
        isSelected: isMarkActive(schema.marks.bold),
      });
    }

    if (schema.marks.italic) {
      marks.push({
        key: "italic",
        label: stringFormatter.format("editorItalic"),
        icon: italicIcon,
        shortcut: `I`,
        command: toggleMark(schema.marks.italic),
        isSelected: isMarkActive(schema.marks.italic),
      });
    }
    if (schema.marks.underline) {
      marks.push({
        key: "underline",
        label: stringFormatter.format("editorUnderline"),
        icon: underlineIcon,
        shortcut: `U`,
        command: toggleMark(schema.marks.underline),
        isSelected: isMarkActive(schema.marks.underline),
      });
    }
    // Text color sits between underline and the rest (strikethrough, code,
    // clear formatting) - it's rendered separately below since it opens a
    // dialog rather than toggling a simple mark.
    const textColorInsertIndex = marks.length;
    if (schema.marks.strikethrough) {
      marks.push({
        key: "strikethrough",
        label: stringFormatter.format("editorStrikethrough"),
        icon: strikethroughIcon,
        command: toggleMark(schema.marks.strikethrough),
        isSelected: isMarkActive(schema.marks.strikethrough),
      });
    }
    if (schema.marks.code) {
      marks.push({
        key: "code",
        label: stringFormatter.format("editorCode"),
        icon: codeIcon,
        command: toggleMark(schema.marks.code),
        isSelected: isMarkActive(schema.marks.code),
      });
    }

    for (const [name, componentConfig] of Object.entries(schema.components)) {
      if (componentConfig.kind !== "mark") continue;
      marks.push({
        key: name,
        label: componentConfig.label,
        icon: componentConfig.icon,
        command: toggleMark(schema.schema.marks[name]),
        isSelected: isMarkActive(schema.schema.marks[name]),
      });
    }

    marks.push({
      key: "clearFormatting",
      label: stringFormatter.format("editorClearFormatting"),
      icon: removeFormattingIcon,
      command: removeAllMarks(),
      isSelected: () => false,
    });
    return { inlineMarks: marks, textColorInsertIndex };
  }, [schema, stringFormatter]);
  const selectedKeys = useMemoStringified(
    inlineMarks.filter((val) => val.isSelected(state)).map((val) => val.key),
  );
  const disabledKeys = useMemoStringified(
    inlineMarks.filter((val) => !val.command(state)).map((val) => val.key),
  );

  return useMemo(() => {
    return (
      <EditorToolbarGroup
        aria-label={stringFormatter.format("editorTextFormatting")}
        value={selectedKeys}
        onChange={(key) => {
          const mark = inlineMarks.find((mark) => mark.key === key);
          if (mark) {
            runCommand(mark.command);
          }
        }}
        disabledKeys={disabledKeys}
        selectionMode="multiple"
      >
        {inlineMarks.slice(0, textColorInsertIndex).map(renderInlineMark)}
        {schema.marks.textColor && (
          <TextColorButton textColor={schema.marks.textColor} />
        )}
        {inlineMarks.slice(textColorInsertIndex).map(renderInlineMark)}
      </EditorToolbarGroup>
    );
  }, [disabledKeys, inlineMarks, runCommand, schema.marks.textColor, selectedKeys, textColorInsertIndex, stringFormatter]);
}

function renderInlineMark(mark: {
  key: string;
  label: string;
  icon: ReactElement;
  shortcut?: string;
}) {
  return (
    <TooltipTrigger key={mark.key}>
      <EditorToolbarItem value={mark.key} aria-label={mark.label}>
        <Icon src={mark.icon} />
      </EditorToolbarItem>
      <Tooltip>
        <Text>{mark.label}</Text>
        {"shortcut" in mark && <Kbd meta>{mark.shortcut}</Kbd>}
      </Tooltip>
    </TooltipTrigger>
  );
}

function useMemoStringified<T>(value: T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [JSON.stringify(value)]);
}

function getActiveListType(state: EditorState, schema: EditorSchema) {
  const sharedDepth = state.selection.$from.sharedDepth(state.selection.to);
  for (let i = sharedDepth; i > 0; i--) {
    const node = state.selection.$from.node(i);
    if (node.type === schema.nodes.ordered_list) {
      return "ordered_list" as const;
    } else if (node.type === schema.nodes.unordered_list) {
      return "unordered_list" as const;
    }
  }
  return null;
}

function ListButtons() {
  const state = useEditorState();
  const schema = useEditorSchema();
  const dispatchCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const canWrapInOrderedList =
    !!schema.nodes.ordered_list && toggleList(schema.nodes.ordered_list)(state);
  const canWrapInUnorderedList =
    !!schema.nodes.unordered_list &&
    toggleList(schema.nodes.unordered_list)(state);
  const activeListType = getActiveListType(state, schema);

  const items = useMemo(() => {
    return [
      !!schema.nodes.unordered_list && {
        label: stringFormatter.format("editorBulletList"),
        key: "unordered_list",
        shortcut: "-",
        icon: listIcon,
      },
      !!schema.nodes.ordered_list && {
        label: stringFormatter.format("editorNumberedList"),
        key: "ordered_list",
        shortcut: "1.",
        icon: listOrderedIcon,
      },
    ].filter(removeFalse);
  }, [schema.nodes.unordered_list, schema.nodes.ordered_list, stringFormatter]);

  const disabledKeys = useMemo(() => {
    return [
      !canWrapInOrderedList && "ordered_list",
      !canWrapInUnorderedList && "unordered_list",
    ].filter(removeFalse);
  }, [canWrapInOrderedList, canWrapInUnorderedList]);

  return useMemo(() => {
    if (items.length === 0) {
      return null;
    }

    return (
      <EditorToolbarGroup
        aria-label={stringFormatter.format("editorLists")}
        value={activeListType}
        onChange={(key) => {
          const format = key as "ordered_list" | "unordered_list";
          const type = schema.nodes[format];
          if (type) {
            dispatchCommand(toggleList(type));
          }
        }}
        disabledKeys={disabledKeys}
        selectionMode="single"
      >
        {items.map((item) => (
          <TooltipTrigger key={item.key}>
            <EditorToolbarItem value={item.key} aria-label={item.label}>
              <Icon src={item.icon} />
            </EditorToolbarItem>
            <Tooltip>
              <Text>{item.label}</Text>
              <Kbd>{item.shortcut}</Kbd>
            </Tooltip>
          </TooltipTrigger>
        ))}
      </EditorToolbarGroup>
    );
  }, [activeListType, disabledKeys, dispatchCommand, items, schema.nodes, stringFormatter]);
}

function removeFalse<T>(val: T): val is Exclude<T, false> {
  return val !== false;
}

type TextAlignValue = "left" | "center" | "right" | "justify";

function getTextAlignItems(
  stringFormatter: ReturnType<typeof useLocalizedStringFormatter>,
) {
  return [
    { key: "left", label: stringFormatter.format("editorAlignLeft"), icon: alignLeftIcon },
    { key: "center", label: stringFormatter.format("editorAlignCenter"), icon: alignCenterIcon },
    { key: "right", label: stringFormatter.format("editorAlignRight"), icon: alignRightIcon },
    { key: "justify", label: stringFormatter.format("editorJustify"), icon: alignJustifyIcon },
  ] as const;
}

function nodeSupportsTextAlign(node: { type: NodeType }) {
  const attrs = node.type.spec.attrs;
  return !!attrs && "textAlign" in attrs;
}

// sets the `textAlign` attr on every alignable block (paragraph, heading) that
// overlaps the selection; `null` clears alignment (used for the default "left").
function setTextAlign(align: TextAlignValue | null): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    let tr = state.tr;
    let applied = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (nodeSupportsTextAlign(node)) {
        applied = true;
        if (dispatch) {
          tr = tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            textAlign: align,
          });
        }
      }
    });
    if (!applied) return false;
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

function getTextAlignState(state: EditorState): {
  isDisabled: boolean;
  selected: TextAlignValue | null;
} {
  const { from, to } = state.selection;
  let align: string | null | undefined;
  let found = false;
  let mixed = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (nodeSupportsTextAlign(node)) {
      found = true;
      const nodeAlign = (node.attrs.textAlign as string | null) ?? null;
      if (align === undefined) align = nodeAlign;
      else if (align !== nodeAlign) mixed = true;
    }
  });
  if (!found) return { isDisabled: true, selected: null };
  if (mixed) return { isDisabled: false, selected: null };
  return { isDisabled: false, selected: (align ?? "left") as TextAlignValue };
}

// a single icon button (mirroring the active block's current alignment,
// defaulting to left) that opens a dropdown of the same icon+label options
// the old 4-button group used - collapses what used to be 4 toolbar slots
// into 1.
function AlignmentControls() {
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { isDisabled, selected } = getTextAlignState(state);
  const current = selected ?? "left";
  const items = useMemo(
    () => getTextAlignItems(stringFormatter),
    [stringFormatter],
  );
  const currentItem =
    items.find((item) => item.key === current) ?? items[0];

  return useMemo(
    () => (
      <TooltipTrigger>
        <MenuTrigger>
          <ActionButton
            prominence="low"
            isDisabled={isDisabled}
            aria-label={stringFormatter.format("editorTextAlignment")}
          >
            <Icon src={currentItem.icon} />
          </ActionButton>
          <Menu
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[current]}
            onAction={(key) => {
              runCommand(
                setTextAlign(key === "left" ? null : (key as TextAlignValue)),
              );
            }}
          >
            {items.map((item) => (
              <Item key={item.key} textValue={item.label}>
                <Icon src={item.icon} />
                <Text>{item.label}</Text>
              </Item>
            ))}
          </Menu>
        </MenuTrigger>
        <Tooltip>
          <Text>{currentItem.label}</Text>
        </Tooltip>
      </TooltipTrigger>
    ),
    [isDisabled, current, currentItem, runCommand, items, stringFormatter],
  );
}

function removeAllMarks(): Command {
  return (state, dispatch) => {
    if (state.selection.empty) {
      return false;
    }

    if (dispatch) {
      dispatch(state.tr.removeMark(state.selection.from, state.selection.to));
    }
    return true;
  };
}

function typeInSelection(type: NodeType) {
  return (state: EditorState) => {
    let hasBlock = false;
    for (const range of state.selection.ranges) {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
        if (node.type === type) {
          hasBlock = true;
        }
      });
      if (hasBlock) break;
    }
    return hasBlock;
  };
}
