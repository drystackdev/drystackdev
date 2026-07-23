import { Mark, MarkType, Node, ResolvedPos } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { ReactElement, useMemo, useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../../app/l10n";

import { ActionButton } from "@keystar/ui/button";
import { EditorPopover, EditorPopoverProps } from "@keystar/ui/editor";
import { Icon } from "@keystar/ui/icon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { Divider, Flex } from "@keystar/ui/layout";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";

import {
  useEditorDispatchCommand,
  useEditorSchema,
  useEditorViewRef,
} from "../editor-view";
import { EditorSchema, getEditorSchema } from "../schema";
import { LinkToolbar } from "./link-toolbar";
import { useEditorReferenceElement } from "./reference";
import { ImagePopover } from "./images";
import { SvgPopover } from "./svg";
import { ContentRefPopover } from "./content-ref";
import { CellOptionsMenu, isSelectionInTableCell } from "./table";
import { GridItemControls, GridPopover } from "./grid";
import { CaptionButton } from "../figcaption";
import { Dialog, DialogContainer } from "@keystar/ui/dialog";
import { FormValue } from "../FormValue";
import { Heading } from "@keystar/ui/typography";
import { pencilIcon } from "@keystar/ui/icon/icons/pencilIcon";
import { ComponentSchema } from "../../../../api";
import { toSerialized, useDeserializedValue } from "../props-serialization";
import { TextField } from "@keystar/ui/text-field";

type NodePopoverRenderer = (props: {
  node: Node;
  state: EditorState;
  pos: number;
}) => ReactElement | null;

// "Remove table" icon (a table with a torn/cut corner) - not in @keystar/ui's
// bundled set, but drawn in the same 24×24 stroke convention as its other
// icons, so it goes through <Icon> like any of them. Used only for the two
// table-specific remove buttons below - other node types keep `trash2Icon`.
const tableDeleteIcon = (
  <path d="M21 12V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m9-12H3m6-6v18m8-4l4 4m0-4l-4 4" />
);

function ExtraAttributesMenuItem(props: {
  schema: Record<string, ComponentSchema>;
  name: string;
  serialized: any;
  pos: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const componentSchema = useMemo(
    () => ({ kind: "object" as const, fields: props.schema }),
    [props.schema],
  );
  const value = useDeserializedValue(props.serialized, props.schema);
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          onPress={() => {
            setIsOpen(true);
          }}
        >
          <Icon src={pencilIcon} />
        </ActionButton>
        <Tooltip>{stringFormatter.format("edit")}</Tooltip>
      </TooltipTrigger>
      <DialogContainer
        onDismiss={() => {
          setIsOpen(false);
        }}
      >
        {isOpen && (
          <Dialog>
            <Heading>
              {stringFormatter.format("editorEditItem", { name: props.name })}
            </Heading>
            <FormValue
              schema={componentSchema}
              value={value}
              onSave={(value) => {
                runCommand((state, dispatch) => {
                  if (dispatch) {
                    dispatch(
                      state.tr.setNodeAttribute(
                        props.pos,
                        "props",
                        toSerialized(value, props.schema),
                      ),
                    );
                  }
                  return true;
                });
              }}
            />
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

function withShouldUse(
  val: NodePopoverRenderer,
  shouldShow: (schema: EditorSchema) => boolean,
): NodePopoverRenderer & { shouldShow(schema: EditorSchema): boolean } {
  return Object.assign(val, { shouldShow });
}

const popoverComponents: Record<
  string,
  NodePopoverRenderer & { shouldShow?(schema: EditorSchema): boolean }
> = {
  code_block: function CodeBlockPopover(props) {
    const dispatchCommand = useEditorDispatchCommand();
    const schema = useEditorSchema();
    const viewRef = useEditorViewRef();
    const stringFormatter = useLocalizedStringFormatter(l10nMessages);
    return (
      <Flex gap="regular" padding="regular">
        <TextField
          aria-label={stringFormatter.format("editorCodeBlockLanguage")}
          value={props.node.attrs.language}
          onChange={(val) => {
            const view = viewRef.current!;
            view.dispatch(
              view.state.tr.setNodeAttribute(props.pos, "language", val),
            );
          }}
        />
        {!!Object.keys(schema.config.codeBlock!.schema).length && (
          <ExtraAttributesMenuItem
            name={stringFormatter.format("editorCodeBlock")}
            schema={schema.config.codeBlock!.schema}
            pos={props.pos}
            serialized={props.node.attrs.props}
          />
        )}
        <Divider orientation="vertical" />
        <TooltipTrigger>
          <ActionButton
            prominence="low"
            onPress={() => {
              dispatchCommand((state, dispatch) => {
                if (dispatch) {
                  dispatch(
                    state.tr.delete(props.pos, props.pos + props.node.nodeSize),
                  );
                }
                return true;
              });
            }}
          >
            <Icon src={trash2Icon} />
          </ActionButton>
          <Tooltip tone="critical">{stringFormatter.format("remove")}</Tooltip>
        </TooltipTrigger>
      </Flex>
    );
  },
  image: ImagePopover,
  svg: SvgPopover,
  grid: GridPopover,
  content_ref: ContentRefPopover,
  table: function TablePopover(props) {
    const dispatchCommand = useEditorDispatchCommand();
    const stringFormatter = useLocalizedStringFormatter(l10nMessages);

    return (
      <Flex gap="regular" padding="regular" alignItems="center">
        {isSelectionInTableCell(props.state) && (
          <>
            <CellOptionsMenu node={props.node} />
            <Divider orientation="vertical" />
          </>
        )}
        <CaptionButton
          caption={props.node.attrs.caption}
          onSubmit={(caption) => {
            dispatchCommand((state, dispatch) => {
              if (dispatch) {
                dispatch(state.tr.setNodeAttribute(props.pos, "caption", caption));
              }
              return true;
            });
          }}
        />
        <Divider orientation="vertical" />
        <TooltipTrigger>
          <ActionButton
            prominence="low"
            onPress={() => {
              dispatchCommand((state, dispatch) => {
                if (dispatch) {
                  dispatch(
                    state.tr.delete(props.pos, props.pos + props.node.nodeSize),
                  );
                }
                return true;
              });
            }}
          >
            <Icon src={tableDeleteIcon} />
          </ActionButton>
          <Tooltip tone="critical">{stringFormatter.format("remove")}</Tooltip>
        </TooltipTrigger>
      </Flex>
    );
  },
  heading: withShouldUse(
    function HeadingPopover(props) {
      const dispatchCommand = useEditorDispatchCommand();
      const schema = useEditorSchema();
      const stringFormatter = useLocalizedStringFormatter(l10nMessages);
      return (
        <Flex gap="regular" padding="regular">
          <ExtraAttributesMenuItem
            name={stringFormatter.format("editorHeadingName")}
            schema={schema.config.heading.schema}
            pos={props.pos}
            serialized={props.node.attrs.props}
          />
          <Divider orientation="vertical" />
          <TooltipTrigger>
            <ActionButton
              prominence="low"
              onPress={() => {
                dispatchCommand((state, dispatch) => {
                  if (dispatch) {
                    dispatch(
                      state.tr.delete(
                        props.pos,
                        props.pos + props.node.nodeSize,
                      ),
                    );
                  }
                  return true;
                });
              }}
            >
              <Icon src={trash2Icon} />
            </ActionButton>
            <Tooltip tone="critical">{stringFormatter.format("remove")}</Tooltip>
          </TooltipTrigger>
        </Flex>
      );
    },
    (schema) => !!Object.keys(schema.config.heading.schema).length,
  ),
} satisfies Partial<Record<keyof EditorSchema["nodes"], NodePopoverRenderer>>;

// A table living inside a grid cell (`grid > grid_cell > table`) sits under
// two popover-worthy ancestors, but the plain ancestor walk in
// `getPopoverDecoration` stops at the first match - the table - so the
// enclosing grid's controls (add/delete item, layout, settings) become
// unreachable while editing that table. This merges both toolbars into one
// instead of picking one over the other.
function TableInGridPopover(props: {
  grid: { node: Node; pos: number };
  table: { node: Node; pos: number };
  state: EditorState;
}) {
  const dispatchCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <Flex gap="regular" padding="regular" alignItems="center">
      <GridItemControls
        node={props.grid.node}
        state={props.state}
        pos={props.grid.pos}
      />
      {isSelectionInTableCell(props.state) && (
        <>
          <Divider orientation="vertical" />
          <CellOptionsMenu node={props.table.node} />
        </>
      )}
      <Divider orientation="vertical" />
      <CaptionButton
        caption={props.table.node.attrs.caption}
        onSubmit={(caption) => {
          dispatchCommand((state, dispatch) => {
            if (dispatch) {
              dispatch(
                state.tr.setNodeAttribute(props.table.pos, "caption", caption),
              );
            }
            return true;
          });
        }}
      />
      <Divider orientation="vertical" />
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          onPress={() => {
            dispatchCommand((state, dispatch) => {
              if (dispatch) {
                dispatch(
                  state.tr.delete(
                    props.table.pos,
                    props.table.pos + props.table.node.nodeSize,
                  ),
                );
              }
              return true;
            });
          }}
        >
          <Icon src={tableDeleteIcon} />
        </ActionButton>
        <Tooltip tone="critical">{stringFormatter.format("editorRemoveTable")}</Tooltip>
      </TooltipTrigger>
    </Flex>
  );
}

// Walks ancestors from `fromDepth` up looking for an enclosing `grid` node -
// used to detect the table-in-grid case above. Depth-generic (rather than
// just checking the immediate parent) since a table sits a couple of levels
// under its grid (`grid > grid_cell > table`).
function findGridAncestor($pos: ResolvedPos, fromDepth: number) {
  for (let i = fromDepth; i > 0; i--) {
    const node = $pos.node(i);
    if (node.type.name === "grid") {
      return { node, pos: $pos.start(i) - 1 };
    }
  }
  return null;
}

export function markAround($pos: ResolvedPos, markType: MarkType) {
  const { parent, parentOffset } = $pos;
  const start = parent.childAfter(parentOffset);
  if (!start.node) return null;

  const mark = start.node.marks.find((mark) => mark.type === markType);
  if (!mark) return null;

  let startIndex = $pos.index();
  let startPos = $pos.start() + start.offset;
  let endIndex = startIndex + 1;
  let endPos = startPos + start.node.nodeSize;
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
    startPos -= parent.child(startIndex).nodeSize;
  }
  while (
    endIndex < parent.childCount &&
    mark.isInSet(parent.child(endIndex).marks)
  ) {
    endPos += parent.child(endIndex).nodeSize;
    endIndex += 1;
  }
  return { from: startPos, to: endPos, mark };
}

type MarkPopoverRenderer = (props: {
  mark: Mark;
  state: EditorState;
  from: number;
  to: number;
}) => ReactElement | null;

const LinkPopover: MarkPopoverRenderer = (props) => {
  const dispatchCommand = useEditorDispatchCommand();
  const href = props.mark.attrs.href;
  if (typeof href !== "string") {
    return null;
  }
  return (
    <LinkToolbar
      text={props.state.doc.textBetween(props.from, props.to)}
      href={href}
      onUnlink={() => {
        dispatchCommand((state, dispatch) => {
          if (dispatch) {
            dispatch(
              state.tr.removeMark(
                props.from,
                props.to,
                state.schema.marks.link,
              ),
            );
          }
          return true;
        });
      }}
      onHrefChange={(href) => {
        dispatchCommand((state, dispatch) => {
          if (dispatch) {
            dispatch(
              state.tr
                .removeMark(props.from, props.to, state.schema.marks.link)
                .addMark(
                  props.from,
                  props.to,
                  state.schema.marks.link.create({ href }),
                ),
            );
          }
          return true;
        });
      }}
    />
  );
};

type PopoverDecoration =
  | {
      adaptToBoundary: EditorPopoverProps["adaptToBoundary"] & {};
      kind: "node";
      component: NodePopoverRenderer;
      node: Node;
      pos: number;
    }
  | {
      adaptToBoundary: EditorPopoverProps["adaptToBoundary"] & {};
      kind: "mark";
      component: MarkPopoverRenderer;
      mark: Mark;
      from: number;
      to: number;
    }
  | {
      adaptToBoundary: EditorPopoverProps["adaptToBoundary"] & {};
      kind: "table-in-grid";
      grid: { node: Node; pos: number };
      table: { node: Node; pos: number };
    };

function InlineComponentPopover(props: {
  node: Node;
  state: EditorState;
  pos: number;
}) {
  const schema = getEditorSchema(props.state.schema);
  const componentConfig = schema.components[props.node.type.name];
  const runCommand = useEditorDispatchCommand();
  const [isOpen, setIsOpen] = useState(false);
  const componentSchema = useMemo(
    () => ({ kind: "object" as const, fields: componentConfig.schema }),
    [componentConfig.schema],
  );
  const value = useDeserializedValue(
    props.node.attrs.props,
    componentConfig.schema,
  );
  const editorViewRef = useEditorViewRef();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  if (componentConfig.kind === "inline" && componentConfig.ToolbarView) {
    return (
      <componentConfig.ToolbarView
        value={value}
        onChange={(value) => {
          const view = editorViewRef.current!;
          view.dispatch(
            view.state.tr.setNodeAttribute(
              props.pos,
              "props",
              toSerialized(value, componentSchema.fields),
            ),
          );
        }}
        onRemove={() => {
          runCommand((state, dispatch) => {
            if (dispatch) {
              dispatch(
                state.tr.delete(props.pos, props.pos + props.node.nodeSize),
              );
            }
            return true;
          });
        }}
      />
    );
  }
  return (
    <>
      <Flex gap="regular" padding="regular">
        <TooltipTrigger>
          <ActionButton
            prominence="low"
            onPress={() => {
              setIsOpen(true);
            }}
          >
            <Icon src={pencilIcon} />
          </ActionButton>
          <Tooltip>{stringFormatter.format("edit")}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton
            prominence="low"
            onPress={() => {
              runCommand((state, dispatch) => {
                if (dispatch) {
                  dispatch(
                    state.tr.delete(props.pos, props.pos + props.node.nodeSize),
                  );
                }
                return true;
              });
            }}
          >
            <Icon src={trash2Icon} />
          </ActionButton>
          <Tooltip tone="critical">{stringFormatter.format("remove")}</Tooltip>
        </TooltipTrigger>
      </Flex>
      <DialogContainer
        onDismiss={() => {
          setIsOpen(false);
        }}
      >
        {isOpen && (
          <Dialog>
            <Heading>
              {stringFormatter.format("editorEditItem", {
                name: componentConfig.label,
              })}
            </Heading>
            <FormValue
              schema={componentSchema}
              value={value}
              onSave={(value) => {
                runCommand((state, dispatch) => {
                  if (dispatch) {
                    dispatch(
                      state.tr.setNodeAttribute(
                        props.pos,
                        "props",
                        toSerialized(value, componentSchema.fields),
                      ),
                    );
                  }
                  return true;
                });
              }}
            />
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

const CustomMarkPopover: MarkPopoverRenderer = (props) => {
  const schema = getEditorSchema(props.state.schema);
  const componentConfig = schema.components[props.mark.type.name];
  const runCommand = useEditorDispatchCommand();
  const [isOpen, setIsOpen] = useState(false);
  const componentSchema = useMemo(
    () => ({ kind: "object" as const, fields: componentConfig.schema }),
    [componentConfig.schema],
  );
  const deserialized = useDeserializedValue(
    props.mark.attrs.props,
    componentConfig.schema,
  );
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <>
      <Flex gap="regular" padding="regular">
        <TooltipTrigger>
          <ActionButton
            prominence="low"
            onPress={() => {
              setIsOpen(true);
            }}
          >
            <Icon src={pencilIcon} />
          </ActionButton>
          <Tooltip>{stringFormatter.format("edit")}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton
            prominence="low"
            onPress={() => {
              runCommand((state, dispatch) => {
                if (dispatch) {
                  dispatch(
                    state.tr.removeMark(props.from, props.to, props.mark.type),
                  );
                }
                return true;
              });
            }}
          >
            <Icon src={trash2Icon} />
          </ActionButton>
          <Tooltip tone="critical">{stringFormatter.format("remove")}</Tooltip>
        </TooltipTrigger>
      </Flex>
      <DialogContainer
        onDismiss={() => {
          setIsOpen(false);
        }}
      >
        {isOpen && (
          <Dialog>
            <Heading>
              {stringFormatter.format("editorEditItem", {
                name: componentConfig.label,
              })}
            </Heading>
            <FormValue
              schema={componentSchema}
              value={deserialized}
              onSave={(value) => {
                runCommand((state, dispatch) => {
                  if (dispatch) {
                    dispatch(
                      state.tr
                        .removeMark(props.from, props.to, props.mark.type)
                        .addMark(
                          props.from,
                          props.to,
                          props.mark.type.create({
                            props: toSerialized(value, componentConfig.schema),
                          }),
                        ),
                    );
                  }
                  return true;
                });
              }}
            />
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
};

// Node popovers default to 'stick' so they don't jump above the reference
// when space runs out. Images are floated (`float: left`/`float: right`),
// so wrapped paragraph text can leave little room below them - 'stick' would
// then wedge the toolbar into that cramped space instead of moving it above
// the image, so images get 'flip'.
//
// A grid hits the same cramped-space case from a different direction: as the
// last block in the document there's nothing below it but the trailing
// paragraph, which is far shorter than the toolbar, and `boundary` is the
// editor's own DOM - so 'stick' has nowhere to put the toolbar except back on
// top of the grid's cells. 'flip' moves it above the grid instead. Only
// affects the case that was already broken: while the toolbar does fit below,
// 'flip' leaves it exactly where 'stick' would.
function popoverAdaptToBoundary(
  node: Node,
): EditorPopoverProps["adaptToBoundary"] & {} {
  return FLOATABLE_NODE_TYPES.has(node.type.name) ||
    node.type.name === "grid"
    ? "flip"
    : "stick";
}

// Nodes whose view can be floated out of normal flow (`float: left`/`right`),
// which is what makes both the popover placement and its stacking order
// special - see `popoverAdaptToBoundary` and the `zIndex` in `PopoverInner`.
const FLOATABLE_NODE_TYPES = new Set(["image", "svg"]);

function getPopoverDecoration(state: EditorState): PopoverDecoration | null {
  if (state.selection instanceof TextSelection) {
    const schema = getEditorSchema(state.schema);
    let decoration: PopoverDecoration | null = null;
    for (const [name, componentConfig] of Object.entries(schema.components)) {
      if (
        componentConfig.kind !== "mark" ||
        !Object.keys(componentConfig.schema).length
      ) {
        continue;
      }
      const mark = schema.schema.marks[name];
      const aroundFrom = markAround(state.selection.$from, mark);
      const aroundTo = markAround(state.selection.$to, mark);
      if (
        aroundFrom &&
        aroundFrom.from === aroundTo?.from &&
        aroundFrom.to === aroundTo.to
      ) {
        const rangeSize = aroundFrom.to - aroundFrom.from;
        if (!decoration || rangeSize < decoration.to - decoration.from) {
          decoration = {
            adaptToBoundary: "flip",
            kind: "mark",
            component: CustomMarkPopover,
            mark: aroundFrom.mark,
            from: aroundFrom.from,
            to: aroundFrom.to,
          };
        }
      }
    }
    if (schema.marks.link) {
      const linkAroundFrom = markAround(
        state.selection.$from,
        schema.marks.link,
      );
      const linkAroundTo = markAround(state.selection.$to, schema.marks.link);
      if (
        linkAroundFrom &&
        linkAroundFrom.from === linkAroundTo?.from &&
        linkAroundFrom.to === linkAroundTo.to
      ) {
        const rangeSize = linkAroundFrom.to - linkAroundFrom.from;
        if (!decoration || rangeSize < decoration.to - decoration.from) {
          return {
            adaptToBoundary: "flip",
            kind: "mark",
            component: LinkPopover,
            mark: linkAroundFrom.mark,
            from: linkAroundFrom.from,
            to: linkAroundFrom.to,
          };
        }
      }
    }
    if (decoration) {
      return decoration;
    }
  }

  const editorSchema = getEditorSchema(state.schema);

  if (state.selection instanceof NodeSelection) {
    const node = state.selection.node;
    if (editorSchema.components[node.type.name]?.kind === "inline") {
      return {
        adaptToBoundary: "stick",
        kind: "node",
        node,
        component: InlineComponentPopover,
        pos: state.selection.from,
      };
    }
    const component = popoverComponents[node.type.name];
    if (
      component !== undefined &&
      (!component.shouldShow || component.shouldShow(editorSchema))
    ) {
      if (node.type.name === "table") {
        const gridAncestor = findGridAncestor(
          state.selection.$from,
          state.selection.$from.depth,
        );
        if (gridAncestor) {
          return {
            adaptToBoundary: "flip",
            kind: "table-in-grid",
            grid: gridAncestor,
            table: { node, pos: state.selection.from },
          };
        }
      }
      return {
        adaptToBoundary: popoverAdaptToBoundary(node),
        kind: "node",
        node,
        component,
        pos: state.selection.from,
      };
    }
  }

  const commonAncestorPos = state.selection.$from.start(
    state.selection.$from.sharedDepth(state.selection.to),
  );
  const $pos = state.doc.resolve(commonAncestorPos);

  for (let i = $pos.depth; i > 0; i--) {
    const node = $pos.node(i);
    if (!node) break;
    const component = popoverComponents[node.type.name];
    if (
      component !== undefined &&
      (!component.shouldShow || component.shouldShow(editorSchema))
    ) {
      const pos = $pos.start(i) - 1;
      if (node.type.name === "table") {
        const gridAncestor = findGridAncestor($pos, i - 1);
        if (gridAncestor) {
          return {
            adaptToBoundary: "flip",
            kind: "table-in-grid",
            grid: gridAncestor,
            table: { node, pos },
          };
        }
      }
      return {
        adaptToBoundary: popoverAdaptToBoundary(node),
        kind: "node",
        node,
        component,
        pos,
      };
    }
  }

  return null;
}

function PopoverInner(props: {
  decoration: PopoverDecoration;
  state: EditorState;
}) {
  const from =
    props.decoration.kind === "node"
      ? props.decoration.pos
      : props.decoration.kind === "table-in-grid"
        ? props.decoration.table.pos
        : props.decoration.from;
  const to =
    props.decoration.kind === "node"
      ? props.decoration.pos + props.decoration.node.nodeSize
      : props.decoration.kind === "table-in-grid"
        ? props.decoration.table.pos + props.decoration.table.node.nodeSize
        : props.decoration.to;

  const reference = useEditorReferenceElement(from, to);
  const editorViewRef = useEditorViewRef();
  const isFloatable =
    props.decoration.kind === "node" &&
    FLOATABLE_NODE_TYPES.has(props.decoration.node.type.name);

  return (
    reference && (
      <EditorPopover
        adaptToBoundary={props.decoration.adaptToBoundary}
        // constrain to the editor's own content area rather than the
        // default `clippingAncestors` (which falls back to the viewport
        // when no ancestor actually clips overflow) - otherwise, in a
        // split-pane layout, shift() treats the sidebar next to the editor
        // as free space and slides the popover under its buttons
        boundary={editorViewRef.current?.dom}
        minWidth="element.medium"
        placement="bottom"
        portal={false}
        reference={reference}
        // the image/svg node view's floated container can otherwise stack
        // in front of the popover (both are positioned, and float order
        // isn't the same as DOM/paint order here), swallowing clicks on
        // the toolbar
        UNSAFE_style={isFloatable ? { zIndex: 2 } : undefined}
      >
        {props.decoration.kind === "table-in-grid" ? (
          <TableInGridPopover
            grid={props.decoration.grid}
            table={props.decoration.table}
            state={props.state}
          />
        ) : props.decoration.kind === "node" ? (
          <props.decoration.component
            {...props.decoration}
            state={props.state}
          />
        ) : (
          <props.decoration.component
            {...props.decoration}
            state={props.state}
          />
        )}
      </EditorPopover>
    )
  );
}

export function EditorPopoverDecoration(props: { state: EditorState }) {
  const popoverDecoration = useMemo(
    () => getPopoverDecoration(props.state),
    [props.state],
  );
  if (!popoverDecoration) return null;
  return <PopoverInner decoration={popoverDecoration} state={props.state} />;
}
