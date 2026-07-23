import { classNames, css, tokenSchema } from "@keystar/ui/style";
import { fileCodeIcon } from "@keystar/ui/icon/icons/fileCodeIcon";
import { heading1Icon } from "@keystar/ui/icon/icons/heading1Icon";
import { heading2Icon } from "@keystar/ui/icon/icons/heading2Icon";
import { heading3Icon } from "@keystar/ui/icon/icons/heading3Icon";
import { heading4Icon } from "@keystar/ui/icon/icons/heading4Icon";
import { heading5Icon } from "@keystar/ui/icon/icons/heading5Icon";
import { heading6Icon } from "@keystar/ui/icon/icons/heading6Icon";
import { imageIcon } from "#icons/imageIcon";
import { svgInsertIcon } from "#icons/svgInsertIcon";
import { listIcon } from "@keystar/ui/icon/icons/listIcon";
import { listOrderedIcon } from "@keystar/ui/icon/icons/listOrderedIcon";
import { quoteIcon } from "@keystar/ui/icon/icons/quoteIcon";
import { tableIcon } from "@keystar/ui/icon/icons/tableIcon";
import { gridInsertIcon } from "#icons/gridInsertIcon";
import { separatorHorizontalIcon } from "@keystar/ui/icon/icons/separatorHorizontalIcon";
import {
  DOMOutputSpec,
  NodeSpec,
  MarkSpec,
  Schema,
  NodeType,
  MarkType,
  AttributeSpec,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import { classes } from "./utils";
import {
  InsertMenuItem,
  WithInsertMenuNodeSpec,
} from "./autocomplete/insert-menu";
import { setBlockType, wrapIn } from "prosemirror-commands";
import { insertNode, insertTable } from "./commands/misc";
import {
  getColumnWidthPercents,
  TableColgroupNodeView,
} from "./table-column-resize";
import { toggleList } from "./lists";
import { independentForGapCursor } from "./gapcursor/gapcursor";
import { WithReactNodeViewSpec } from "./react-node-views";
import { ContentComponent } from "../../../../content-components";
import { getCustomMarkSpecs, getCustomNodeSpecs } from "./custom-components";
import { EditorConfig } from "../config";
import { toSerialized } from "./props-serialization";
import { getInitialPropsValue } from "../../../initial-values";
import {
  openMediaLibrary,
  UNHYDRATED_MEDIA_BYTES,
} from "../../../../app/media-library/bridge";
import { imageAttrsForPick } from "./image-pick";
import { base64UrlEncode, base64UrlDecode } from "#base64";
import { ImageNodeView, imageContainerAlignStyle } from "./image-node-view";
import { SvgNodeView } from "./svg-node-view";
import {
  applySvgLayout,
  PLACEHOLDER_SVG_MARKUP,
  sanitizeSvgElement,
  svgLayoutFromElement,
} from "./svg-markup";
import { GridNodeView, GridCellView } from "./grid-node-view";
import { ContentRefNodeView } from "./content-ref-node-view";
import {
  insertGrid,
  cellStyleString,
  parseGridColumnSpan,
  parseGridColumns,
  parseGridRowSpan,
  parsePlaceContent,
  parseGridGap,
  parseGridRows,
  gridContainerStyle,
  GRID_DEFAULT_SPAN,
  GRID_DEFAULT_ROW_SPAN,
  GRID_DEFAULT_GAP,
  GRID_DEFAULT_COLUMNS,
  GRID_DEFAULT_ROWS,
} from "./grid";
import { imageLayoutFromElement, imageLayoutStyleString } from "./image-layout";

const blockElementSpacing = css({
  marginBlock: "1em",
});

const blockquoteDOM: DOMOutputSpec = [
  "blockquote",
  {
    class: classNames(
      classes.blockParent,
      css({
        [`&.${classes.nodeInSelection}, &.${classes.nodeSelection}`]: {
          borderColor: tokenSchema.color.alias.borderSelected,
        },
      }),
    ),
  },
  0,
];
const dividerDOM: DOMOutputSpec = [
  "hr",
  {
    contenteditable: "false",
    class: css({
      cursor: "pointer",
      [`&.${classes.nodeInSelection}, &.${classes.nodeSelection}`]: {
        backgroundColor: tokenSchema.color.alias.borderSelected,
      },
    }),
  },
];
const hardBreakDOM: DOMOutputSpec = ["br"];

const olDOM: DOMOutputSpec = ["ol", {}, 0];
const ulDOM: DOMOutputSpec = ["ul", {}, 0];
const liDOM: DOMOutputSpec = ["li", {}, 0];

export type EditorNodeSpec = NodeSpec &
  WithInsertMenuNodeSpec &
  WithReactNodeViewSpec;

const inlineContent = `inline*`;

// physical text-align values supported on block nodes (paragraph, heading).
// stored as the `textAlign` attr and round-tripped through inline
// `style="text-align:…"` in the HTML serializer/parser.
export const TEXT_ALIGN_VALUES = new Set([
  "left",
  "center",
  "right",
  "justify",
]);

function getTextAlignAttrs(dom: HTMLElement | string) {
  if (typeof dom === "string") return { textAlign: null };
  const textAlign = dom.style.textAlign;
  return { textAlign: TEXT_ALIGN_VALUES.has(textAlign) ? textAlign : null };
}

// "medium" (the browser default) is deliberately absent - it's represented by
// the mark not being present at all, the same convention TEXT_ALIGN_VALUES
// uses for "left". The keys match the standard CSS absolute-size keywords, so
// they stay meaningful as the `data-dry-font-size` value round-tripped
// through HTML - only the toolbar shows friendlier labels for them.
export const FONT_SIZE_VALUES = {
  "xx-small": "0.625rem",
  "x-small": "0.75rem",
  small: "0.875rem",
  large: "1.25rem",
  "x-large": "1.5rem",
  "xx-large": "2rem",
  "xxx-large": "2.5rem",
} as const;

export type FontSizeKey = keyof typeof FONT_SIZE_VALUES;

// Canonical stored form: 8-digit lowercase hex, "#rrggbbaa" (RGB + alpha
// folded into one value, one representation to validate). Untrusted markup
// (paste, hand-edited HTML, AI codec output) must pass this before a
// `data-dry-text-color` value is trusted.
export const TEXT_COLOR_VALUE_PATTERN = /^#[0-9a-f]{8}$/;

export function isValidTextColorValue(value: string): boolean {
  return TEXT_COLOR_VALUE_PATTERN.test(value);
}

function withTextAlign(
  attrs: Record<string, string>,
  textAlign: string | null,
): Record<string, string> {
  if (!textAlign) return attrs;
  const style = attrs.style
    ? `${attrs.style};text-align:${textAlign}`
    : `text-align:${textAlign}`;
  return { ...attrs, style };
}

const levelsMeta = [
  { description: "Use this for a top level heading", icon: heading1Icon },
  { description: "Use this for key sections", icon: heading2Icon },
  { description: "Use this for sub-sections", icon: heading3Icon },
  { description: "Use this for deep headings", icon: heading4Icon },
  { description: "Use this for grouping list items", icon: heading5Icon },
  { description: "Use this for low-level headings", icon: heading6Icon },
];

const cellAttrs: Record<string, AttributeSpec> = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  // this cell's own width, as a percentage of the table's width - set by
  // dragging the column-resize handle (table-column-resize.ts). Only cells
  // that were actually resized carry a value; the rest stay `null` (auto)
  // and split whatever percentage the explicit columns don't claim.
  widthPercent: { default: null },
};

function widthPercentFromStyle(style: string): number | null {
  const match = /(?:^|;)\s*width\s*:\s*([\d.]+)%/.exec(style);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function heightPxFromStyle(style: string): number | null {
  const match = /(?:^|;)\s*height\s*:\s*([\d.]+)px/.exec(style);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getRowHeightAttrs(dom: HTMLElement | string) {
  if (typeof dom === "string") return { heightPx: null };
  return { heightPx: heightPxFromStyle(dom.style.cssText) };
}

function rowHeightDOMAttrs(node: ProsemirrorNode): Record<string, string> {
  return node.attrs.heightPx
    ? { style: `height:${node.attrs.heightPx}px` }
    : {};
}

function getCellSpanAttrs(dom: HTMLElement | string) {
  if (typeof dom === "string") {
    return { colspan: 1, rowspan: 1, widthPercent: null };
  }
  const colspan = parseInt(dom.getAttribute("colspan") ?? "", 10);
  const rowspan = parseInt(dom.getAttribute("rowspan") ?? "", 10);
  return {
    colspan: Number.isInteger(colspan) && colspan > 0 ? colspan : 1,
    rowspan: Number.isInteger(rowspan) && rowspan > 0 ? rowspan : 1,
    widthPercent: widthPercentFromStyle(dom.style.cssText),
  };
}

function cellSpanDOMAttrs(node: ProsemirrorNode) {
  const attrs: Record<string, string> = {};
  if (node.attrs.colspan > 1) attrs.colspan = String(node.attrs.colspan);
  if (node.attrs.rowspan > 1) attrs.rowspan = String(node.attrs.rowspan);
  if (node.attrs.widthPercent)
    attrs.style = `width:${node.attrs.widthPercent}%`;
  return attrs;
}

// a `<colgroup>` gives every column a single, canonical width regardless of
// which row happens to hold a plain (non-merged) cell for it - unlike
// per-cell `style="width"`, which `table-layout: fixed` only honors on the
// table's first row (see getColumnWidthPercents).
function tableColgroupSpec(table: ProsemirrorNode): DOMOutputSpec {
  const widths = getColumnWidthPercents(table);
  return [
    "colgroup",
    {},
    ...widths.map(
      (pct): DOMOutputSpec => [
        "col",
        pct != null ? { style: `width:${pct}%` } : {},
      ],
    ),
  ];
}

// `width`/`table-layout` match what the serializer writes inline on the
// published <table>, so they're the one part of this class the host page also
// gets - everything else here is the admin's own table skin.
const tableLayoutStyles = {
  width: "100%",
  tableLayout: "fixed",
  position: "relative",
} as const;

// selection affordances the editor needs in both modes: a selected cell's
// own highlight has to win over the browser's text selection.
const tableSelectionStyles = {
  "&:has(.selectedCell) *::selection": {
    backgroundColor: "transparent",
  },

  // stop content from bouncing around when widgets are added
  ".ProseMirror-widget + *": {
    marginTop: 0,
  },
} as const;

const tableElementClass = css({
  ...tableLayoutStyles,
  borderSpacing: 0,
  borderInlineStart: `1px solid ${tokenSchema.color.alias.borderIdle}`,
  borderTop: `1px solid ${tokenSchema.color.alias.borderIdle}`,
  ...tableSelectionStyles,
});

// See createEditorSchema's `hostTypography`. The published table carries none
// of the admin's borders or spacing, so on a host page they'd make the table
// visibly redraw itself the moment edit mode turned on. The cells' dashed
// outlines (below) show where the table is instead.
const tableHostElementClass = css({
  ...tableLayoutStyles,
  ...tableSelectionStyles,
});

// selection + column-resize affordances; carry no typographic opinion, so both
// the admin and host variants want them
const cellAffordanceStyles = {
  boxSizing: "border-box",
  position: "relative",

  "&.selectedCell": {
    backgroundColor: tokenSchema.color.alias.backgroundSelected,
    "& *::selection": {
      backgroundColor: "transparent",
    },
  },
  "&.selectedCell::after": {
    border: `1px solid ${tokenSchema.color.alias.borderSelected}`,
    position: "absolute",
    top: -1,
    left: -1,
    content: '""',
    height: "100%",
    width: "100%",
    // purely decorative - don't let it swallow clicks meant for the cell's
    // own "..." options button (e.g. merging a multi-cell selection)
    pointerEvents: "none",
  },
} as const;

const tableCellClass = css({
  ...cellAffordanceStyles,
  borderBottom: `1px solid ${tokenSchema.color.alias.borderIdle}`,
  borderInlineEnd: `1px solid ${tokenSchema.color.alias.borderIdle}`,
  margin: 0,
  padding: tokenSchema.size.space.regular,
  textAlign: "start",
  verticalAlign: "top",
});
const tableHeaderClass = css(tableCellClass, {
  backgroundColor: tokenSchema.color.scale.slate3,
  fontWeight: tokenSchema.typography.fontWeight.semibold,
});

// The host-page cell, used for both `td` and `th`: no padding, borders,
// alignment or header fill - the page's own rules decide all of that. The
// dashed edge is what's left to show where the cells are, and it's an
// `outline` rather than a `border` because an outline takes no space in the
// box model, so the cell keeps the exact geometry the published page gives it.
const tableHostCellClass = css({
  ...cellAffordanceStyles,
  outline: `1px dashed ${tokenSchema.color.border.muted}`,
  outlineOffset: -1,
});

const nodeSpecs = {
  doc: {
    content: "block+",
  },
  paragraph: {
    content: inlineContent,
    group: "block",
    attrs: { textAlign: { default: null } },
    parseDOM: [
      { tag: "p", getAttrs: getTextAlignAttrs },
      { tag: "[data-ignore-content]", ignore: true },
    ],
    toDOM(node) {
      return [
        "p",
        withTextAlign({ class: blockElementSpacing }, node.attrs.textAlign),
        0,
      ];
    },
  },
  text: {
    group: "inline",
  },
  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM() {
      return blockquoteDOM;
    },
    insertMenu: {
      label: "Blockquote",
      description: "Insert a quote or citation",
      icon: quoteIcon,
      command: wrapIn,
    },
  },
  divider: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM() {
      return dividerDOM;
    },
    insertMenu: {
      label: "Divider",
      description: "A horizontal line to separate content",
      icon: separatorHorizontalIcon,
      command: insertNode,
    },
  },
  code_block: {
    content: "text*",
    group: "block",
    defining: true,
    [independentForGapCursor]: true,
    attrs: {
      language: { default: "" },
    },
    insertMenu: {
      label: "Code block",
      description: "Display code with syntax highlighting",
      icon: fileCodeIcon,
      command: setBlockType,
    },
    marks: "",
    code: true,
    parseDOM: [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs(node) {
          if (typeof node === "string") return {};
          return { language: node.getAttribute("data-language") ?? "" };
        },
      },
    ],
    toDOM(node) {
      return [
        "pre",
        { spellcheck: "false", "data-language": node.attrs.language },
        ["code", {}, 0],
      ];
    },
  },
  list_item: {
    content: "block+",
    parseDOM: [{ tag: "li" }],
    toDOM() {
      return liDOM;
    },
    defining: true,
  },
  unordered_list: {
    content: "list_item+",
    group: "block",
    parseDOM: [{ tag: "ul" }],
    toDOM() {
      return ulDOM;
    },
    insertMenu: {
      label: "Bullet list",
      description: "Insert an unordered list",
      icon: listIcon,
      command: toggleList,
    },
  },
  ordered_list: {
    content: "list_item+",
    group: "block",
    attrs: {
      start: { default: 1 },
    },
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (node) => {
          if (typeof node === "string") {
            return false;
          }
          if (!(node instanceof HTMLOListElement) || node.start < 0) {
            return { start: 1 };
          }
          return { start: node.start };
        },
      },
    ],
    toDOM(node) {
      if (node.attrs.start === 1) return olDOM;
      return ["ol", { start: node.attrs.start }, 0];
    },
    insertMenu: {
      label: "Ordered list",
      description: "Insert an ordered list",
      icon: listOrderedIcon,
      command: toggleList,
    },
  },
  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM() {
      return hardBreakDOM;
    },
  },
  table: {
    content: "table_row+",
    insertMenu: {
      label: "Table",
      description: "Insert a table",
      icon: tableIcon,
      command: insertTable,
    },
    tableRole: "table",
    isolating: true,
    group: "block",
    attrs: {
      // rendered as a `<figcaption>` under the table (see html/serialize.ts
      // and html/parse.ts) - empty means no `<figure>` wrapper at all.
      caption: { default: "" },
    },
    parseDOM: [{ tag: "table" }],
    // the live editor DOM needs `<colgroup>` widths to stay in sync with
    // per-cell resizes, which `toDOM` alone can't do (see
    // TableColgroupNodeView) - `toDOM` remains as the static fallback used
    // by e.g. clipboard serialization, where a snapshot is all that's needed
    nodeView: (node) => new TableColgroupNodeView(node, tableElementClass),
    toDOM(node) {
      return [
        "table",
        { class: tableElementClass },
        tableColgroupSpec(node),
        ["tbody", 0],
      ];
    },
  },
  table_row: {
    content: "(table_cell | table_header)*",
    tableRole: "row",
    allowGapCursor: false,
    attrs: {
      // this row's own height, in px - set by dragging the row-resize handle
      // (table-row-resize.ts). `null` (auto) lets the row size to its content.
      heightPx: { default: null },
    },
    parseDOM: [{ tag: "tr", getAttrs: getRowHeightAttrs }],
    toDOM(node) {
      return ["tr", rowHeightDOMAttrs(node), 0];
    },
  },
  table_cell: {
    content: "block+",
    tableRole: "cell",
    isolating: true,
    attrs: cellAttrs,
    parseDOM: [{ tag: "td", getAttrs: getCellSpanAttrs }],
    toDOM(node) {
      return ["td", { class: tableCellClass, ...cellSpanDOMAttrs(node) }, 0];
    },
  },
  table_header: {
    content: "block+",
    tableRole: "header_cell",
    attrs: cellAttrs,
    isolating: true,
    parseDOM: [{ tag: "th", getAttrs: getCellSpanAttrs }],
    toDOM(node) {
      return ["th", { class: tableHeaderClass, ...cellSpanDOMAttrs(node) }, 0];
    },
  },
  image: {
    content: "",
    group: "inline",
    inline: true,
    attrs: {
      src: {},
      // The URL this image was parsed from (html/parse.ts) - empty for a node
      // inserted this session, which has real bytes instead. Kept because bytes
      // are not always reachable: the visual editor parses a live page whose
      // assets/ listing can come back empty (no GitHub token yet, a failed
      // request), and without this the node has neither bytes nor a URL and
      // renders as a src-less <img>. See useImageObjectUrl.
      srcUrl: { default: "" },
      filename: {},
      alt: { default: "" },
      title: { default: "" },
      width: { default: null },
      height: { default: null },
      align: { default: null },
      // editor-only convenience flag for the width/height fields in the
      // image edit dialog - not serialized to DOM, so it resets to its
      // default (locked) on reload rather than round-tripping
      lockAspectRatio: { default: true },
      // rendered as a `<figcaption>` under the image (see html/serialize.ts
      // and html/parse.ts) - empty means no `<figure>` wrapper at all.
      caption: { default: "" },
    },
    insertMenu: {
      label: "Image",
      description: "Insert an image",
      icon: imageIcon,
      command: (nodeType) => {
        return (state, dispatch, view) => {
          if (dispatch && view) {
            (async () => {
              const picked = await openMediaLibrary({ accept: "image" });
              const schema = getEditorSchema(nodeType.schema);
              if (!picked || !schema.config.image) return;
              const { src, filename } = imageAttrsForPick(
                picked,
                schema.config.image.transformFilename,
                schema.config.supportsMediaLibraryReferences,
              );
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  nodeType.createChecked({ src, filename }),
                ),
              );
            })();
          }
          return true;
        };
      },
    },
    reactNodeView: {
      component: ImageNodeView,
      rendersOwnContent: true,
      containerStyle: (node) => imageContainerAlignStyle(node.attrs.align),
    },
    toDOM(node) {
      const layout = {
        width: node.attrs.width,
        height: node.attrs.height,
        align: node.attrs.align,
      };
      const style = imageLayoutStyleString(layout);
      // A node with no bytes (parsed from stored HTML, untouched since) has
      // nothing to base64 - point at its original URL so a copied image is
      // still an image, and carry `srcUrl` across so pasting it back doesn't
      // land a node with neither bytes nor URL.
      const src =
        node.attrs.src.byteLength > 0 || !node.attrs.srcUrl
          ? `data:${
              node.attrs.filename.endsWith(".svg")
                ? "image/svg+xml"
                : "application/octet-stream"
            };base64,${base64UrlEncode(node.attrs.src)}`
          : node.attrs.srcUrl;
      return [
        "img",
        {
          src,
          alt: node.attrs.alt,
          title: node.attrs.title,
          "data-filename": node.attrs.filename,
          ...(node.attrs.srcUrl ? { "data-dry-src": node.attrs.srcUrl } : {}),
          ...(node.attrs.align ? { "data-align": node.attrs.align } : {}),
          ...(style ? { style } : {}),
        },
      ];
    },
    parseDOM: [
      {
        tag: "img[src][data-filename]",
        getAttrs(node) {
          if (typeof node === "string") return false;
          const src = node.getAttribute("src");
          const filename = node.getAttribute("data-filename");
          if (!filename) return false;
          const srcUrl = node.getAttribute("data-dry-src") ?? "";
          // `data-filename` is only ever written by this node's own toDOM, so
          // reaching here without a data: URL means a bytes-less node made the
          // round trip - it carries its URL in `data-dry-src` instead.
          if (!src?.startsWith("data:") && !srcUrl) return false;
          const srcAsUint8Array = src?.startsWith("data:")
            ? base64UrlDecode(src.replace(/^data:[a-z/-]+;base64,/, ""))
            : UNHYDRATED_MEDIA_BYTES;
          const layout = imageLayoutFromElement(node as HTMLElement);
          return {
            src: srcAsUint8Array,
            srcUrl,
            filename,
            alt: node.getAttribute("alt") ?? "",
            title: node.getAttribute("title") ?? "",
            width: layout.width,
            height: layout.height,
            align: layout.align,
          };
        },
      },
    ],
  },
  // An inline drawing whose markup lives in the document rather than in a
  // sibling asset file. Deliberately shaped like `image` - same layout attrs,
  // same caption, same resize handles, same popover - because to a reader
  // that's exactly what it is. The one thing it doesn't share is bytes: there
  // is no `src`, no filename, and nothing lands in `other` on save. See
  // svg-markup.ts for why inline (theming) and what that costs (sanitizing).
  svg: {
    content: "",
    group: "inline",
    inline: true,
    // Nothing inside is addressable by the editor - the markup is one opaque
    // value - so clicking anywhere in the drawing should select the whole node.
    atom: true,
    attrs: {
      // Always the output of sanitizeSvgElement/sanitizeSvgMarkup. Every path
      // that builds this node goes through one of them; nothing else may write
      // here, because this string is injected into the page as HTML.
      markup: {},
      width: { default: null },
      height: { default: null },
      align: { default: null },
      // editor-only convenience flag for the width/height fields in the edit
      // dialog - not serialized to DOM, so it resets to its default (locked)
      // on reload rather than round-tripping
      lockAspectRatio: { default: true },
      // rendered as a `<figcaption>` under the drawing (see html/serialize.ts
      // and html/parse.ts) - empty means no `<figure>` wrapper at all.
      caption: { default: "" },
    },
    insertMenu: {
      label: "Drawing",
      description: "Insert an inline SVG drawing or chart",
      icon: svgInsertIcon,
      // Its own command rather than the shared `insertNode`, which fills every
      // attr from its default - and `markup` has none, since an empty drawing
      // isn't a thing. Seeds a placeholder for the author to replace via the
      // node's edit dialog.
      command: (nodeType) => (state, dispatch) => {
        if (dispatch) {
          dispatch(
            state.tr.replaceSelectionWith(
              nodeType.createChecked({ markup: PLACEHOLDER_SVG_MARKUP }),
            ),
          );
        }
        return true;
      },
    },
    reactNodeView: {
      component: SvgNodeView,
      rendersOwnContent: true,
      containerStyle: (node) => imageContainerAlignStyle(node.attrs.align),
    },
    toDOM(node) {
      // Only reached for the clipboard (the react node view owns what's on
      // screen), so this has to be markup the `parseDOM` rule below can read
      // back - which is the same shape html/serialize.ts writes to disk.
      const markup = applySvgLayout(node.attrs.markup, {
        width: node.attrs.width,
        height: node.attrs.height,
        align: node.attrs.align,
      });
      const holder = document.createElement("div");
      holder.innerHTML = markup;
      const el = holder.firstElementChild;
      return el ?? (["span", {}] satisfies DOMOutputSpec);
    },
    parseDOM: [
      {
        tag: "svg",
        getAttrs(node) {
          if (typeof node === "string") return false;
          const markup = sanitizeSvgElement(node);
          // Nothing salvageable (not really an svg, or everything in it was
          // outside the allowlist) - refusing the rule drops the element
          // rather than letting ProseMirror unwrap it and spill its `<text>`
          // into the surrounding prose as if it were writing.
          if (!markup) return false;
          const layout = svgLayoutFromElement(node);
          return {
            markup,
            width: layout.width,
            height: layout.height,
            align: layout.align,
          };
        },
      },
    ],
  },
  grid: {
    content: "grid_cell+",
    group: "block",
    isolating: true,
    defining: true,
    attrs: {
      gap: { default: GRID_DEFAULT_GAP },
      // number of grid tracks (configurable per grid via the settings popover)
      columns: { default: GRID_DEFAULT_COLUMNS },
      // number of explicit (equal-height) row tracks - see GRID_DEFAULT_ROWS
      rows: { default: GRID_DEFAULT_ROWS },
      // rendered as a `<figcaption>` under the grid (see html/serialize.ts
      // and html/parse.ts) - empty means no `<figure>` wrapper at all.
      caption: { default: "" },
    },
    insertMenu: {
      label: "Grid Layout",
      description: "Insert a multi-column layout",
      icon: gridInsertIcon,
      command: insertGrid,
    },
    reactNodeView: {
      component: GridNodeView,
    },
    parseDOM: [
      {
        tag: "div[data-dry-grid]",
        getAttrs(dom) {
          if (typeof dom === "string") {
            return {
              gap: GRID_DEFAULT_GAP,
              columns: GRID_DEFAULT_COLUMNS,
              rows: GRID_DEFAULT_ROWS,
            };
          }
          const style = dom.getAttribute("style") ?? "";
          return {
            gap: parseGridGap(style),
            columns: parseGridColumns(style),
            rows: parseGridRows(style),
          };
        },
      },
    ],
    toDOM(node) {
      return [
        "div",
        {
          "data-dry-grid": "",
          style: gridContainerStyle(
            node.attrs.gap,
            node.attrs.columns,
            node.attrs.rows,
          ),
        },
        0,
      ];
    },
  },
  grid_cell: {
    content: "block+",
    isolating: true,
    attrs: {
      span: { default: GRID_DEFAULT_SPAN },
      rowSpan: { default: GRID_DEFAULT_ROW_SPAN },
      place: { default: null },
    },
    reactNodeView: {
      component: GridCellView,
      // the `grid-column`/`grid-row` span must live on the ProseMirror-tracked
      // container (the actual grid item), not several layers of React content
      // deep inside it - same reasoning as the image node's `containerStyle`
      containerStyle: (node) => ({
        gridColumn: `span ${node.attrs.span}`,
        gridRow: `span ${node.attrs.rowSpan}`,
      }),
    },
    parseDOM: [
      {
        tag: "div[data-dry-cell]",
        getAttrs(dom) {
          if (typeof dom === "string") {
            return {
              span: GRID_DEFAULT_SPAN,
              rowSpan: GRID_DEFAULT_ROW_SPAN,
              place: null,
            };
          }
          const style = dom.getAttribute("style") ?? "";
          // clamp the spans against the parent grid's own column/row count
          // (read off the container) so a pasted cell can't exceed its grid
          const gridEl = dom.closest("[data-dry-grid]");
          const gridStyle = gridEl?.getAttribute("style") ?? "";
          const columns = gridEl
            ? parseGridColumns(gridStyle)
            : GRID_DEFAULT_COLUMNS;
          const rows = gridEl ? parseGridRows(gridStyle) : GRID_DEFAULT_ROWS;
          return {
            span: parseGridColumnSpan(style, columns),
            rowSpan: parseGridRowSpan(style, rows),
            place: parsePlaceContent(style),
          };
        },
      },
    ],
    toDOM(node) {
      return [
        "div",
        {
          "data-dry-cell": "",
          style: cellStyleString({
            span: node.attrs.span,
            rowSpan: node.attrs.rowSpan,
            place: node.attrs.place,
          }),
        },
        0,
      ];
    },
  },
  // "Import content" - a read-only, always-live-resolved reference to
  // another singleton/collection's own top-level content field. Its only
  // attr is a pointer (`editKey`-encoded, see app/edit-sync.ts) - never the
  // referenced HTML itself, so there is nothing here to go stale: the editor
  // (ContentRefNodeView) and the published page (see
  // packages/astro/src/content-ref-resolve.ts) each resolve it fresh from
  // whatever the source entry currently holds. Inserted only via its
  // dedicated toolbar button (content-ref.tsx), not the generic insert menu -
  // it needs the current entry's own EntryRef (from ContentRefScopeProvider)
  // to exclude self-reference, which a plain insertMenu.command closure has
  // no way to read.
  content_ref: {
    content: "",
    group: "block",
    atom: true,
    attrs: {
      ref: {},
    },
    reactNodeView: {
      component: ContentRefNodeView,
      rendersOwnContent: true,
    },
    toDOM(node) {
      return ["section", { "data-ref-content": node.attrs.ref }];
    },
    parseDOM: [
      {
        tag: "section[data-ref-content]",
        getAttrs(dom) {
          if (typeof dom === "string") return false;
          const ref = dom.getAttribute("data-ref-content");
          return ref ? { ref } : false;
        },
      },
    ],
  },
} satisfies Record<string, EditorNodeSpec>;

const italicDOM: DOMOutputSpec = ["em", 0];
const boldDOM: DOMOutputSpec = ["strong", 0];
const inlineCodeDOM: DOMOutputSpec = ["code", 0];
const strikethroughDOM: DOMOutputSpec = ["s", 0];
const underlineDOM: DOMOutputSpec = ["u", 0];

const markSpecs = {
  link: {
    attrs: {
      href: {},
      title: { default: "" },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs(node) {
          if (typeof node === "string") return false;
          const href = node.getAttribute("href");
          if (!href) return false;
          return {
            href,
            title: node.getAttribute("title") ?? "",
          };
        },
      },
    ],
    toDOM(node) {
      return [
        "a",
        {
          href: node.attrs.href,
          title: node.attrs.title === "" ? undefined : node.attrs.title,
        },
        0,
      ];
    },
  },
  italic: {
    shortcuts: ["Mod-i", "Mod-I"],
    parseDOM: [
      { tag: "i" },
      { tag: "em" },
      { style: "font-style=italic" },
      { style: "font-style=normal", clearMark: (m) => m.type.name == "italic" },
    ],
    toDOM() {
      return italicDOM;
    },
  },
  bold: {
    shortcuts: ["Mod-b", "Mod-B"],
    parseDOM: [
      { tag: "strong" },
      {
        tag: "b",
        getAttrs: (node) =>
          typeof node === "string"
            ? false
            : node.style.fontWeight != "normal" && null,
      },
      { style: "font-weight=400", clearMark: (m) => m.type.name == "strong" },
      {
        style: "font-weight",
        getAttrs: (value) =>
          typeof value === "string"
            ? /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null
            : false,
      },
    ],
    toDOM() {
      return boldDOM;
    },
  },
  strikethrough: {
    shortcuts: ["Mod-Shift-s", "Mod-Shift-S"],
    parseDOM: [{ tag: "s" }],
    toDOM() {
      return strikethroughDOM;
    },
  },
  underline: {
    shortcuts: ["Mod-u", "Mod-U"],
    parseDOM: [{ tag: "u" }],
    toDOM() {
      return underlineDOM;
    },
  },
  code: {
    shortcuts: ["Mod-`", "Mod-Shift-M", "Mod-E", "Mod-e"],
    parseDOM: [{ tag: "code" }],
    toDOM() {
      return inlineCodeDOM;
    },
  },
  fontSize: {
    attrs: { size: {} },
    parseDOM: [
      {
        tag: "span[data-dry-font-size]",
        getAttrs(dom) {
          if (typeof dom === "string") return false;
          const size = dom.getAttribute("data-dry-font-size");
          return size && size in FONT_SIZE_VALUES ? { size } : false;
        },
      },
    ],
    toDOM(mark) {
      const size = mark.attrs.size as FontSizeKey;
      return [
        "span",
        { "data-dry-font-size": size, style: `font-size:${FONT_SIZE_VALUES[size]}` },
        0,
      ];
    },
  },
  textColor: {
    attrs: { value: {} },
    parseDOM: [
      {
        tag: "span[data-dry-text-color]",
        getAttrs(dom) {
          if (typeof dom === "string") return false;
          const value = dom.getAttribute("data-dry-text-color");
          return value && isValidTextColorValue(value) ? { value } : false;
        },
      },
    ],
    toDOM(mark) {
      const value = mark.attrs.value as string;
      return [
        "span",
        { "data-dry-text-color": value, style: `color:${value}` },
        0,
      ];
    },
  },
} satisfies Record<string, MarkSpec>;

export type EditorSchema = {
  schema: Schema;
  nodes: Partial<{
    [_ in keyof typeof nodeSpecs]: NodeType;
  }> & { doc: {}; text: {}; heading: NodeType };
  marks: Partial<{
    [_ in keyof typeof markSpecs]: MarkType;
  }>;
  config: EditorConfig;
  components: Record<string, ContentComponent>;
  insertMenuItems: InsertMenuItem[];
  format: "mdx" | "markdoc";
  // See createEditorSchema's `hostTypography`. Read by node views that would
  // otherwise impose the editor's own look on content the host page styles
  // itself (image-node-view.tsx's border radius).
  hostTypography: boolean;
};

/**
 * `hostTypography` builds a schema for an editor mounted onto a page that
 * already has its own typography - the visual editor's inline fields.content
 * spots, which edit the live site's own element in place (see
 * form/fields/content/inline.tsx).
 *
 * It drops the editor's own spacing and skin from what the nodes render, so
 * the host page's rules decide the layout instead: a paragraph's block
 * margins, and a table's borders, cell padding and header fill. What's left in
 * these specs are editing affordances (selection outlines, the
 * ProseMirror-blockParent marker, the classes column resizing measures
 * against) with no typographic opinion of their own - dropping those would
 * break editing rather than improve fidelity. Where an affordance still has to
 * be visible on a host page, it's drawn with `outline`, which takes no space in
 * the box model (see `tableHostCellClass`, and grid-node-view's `cellClass`).
 *
 * Without it, a paragraph's `margin-block: 1em` beats the host's own `p` rule
 * on specificity - a class against an element selector - so text visibly
 * shifts the moment edit mode turns on.
 */
export function createEditorSchema(
  config: EditorConfig,
  components: Record<string, ContentComponent>,
  isMDX: boolean,
  opts?: { hostTypography?: boolean },
) {
  const paragraph: EditorNodeSpec = opts?.hostTypography
    ? {
        ...nodeSpecs.paragraph,
        toDOM(node) {
          return ["p", withTextAlign({}, node.attrs.textAlign), 0];
        },
      }
    : nodeSpecs.paragraph;
  const nodeSpecsWithCustomNodes: Record<string, EditorNodeSpec> = {
    doc: config.inlineOnly ? { content: inlineContent } : nodeSpecs.doc,
    ...(config.inlineOnly ? {} : { paragraph }),
    text: nodeSpecs.text,
    hard_break: nodeSpecs.hard_break,
    ...getCustomNodeSpecs(components),
  };
  if (config.blockquote) {
    nodeSpecsWithCustomNodes.blockquote = nodeSpecs.blockquote;
  }
  if (config.divider) {
    nodeSpecsWithCustomNodes.divider = nodeSpecs.divider;
  }
  if (config.codeBlock) {
    nodeSpecsWithCustomNodes.code_block = {
      ...nodeSpecs.code_block,
      attrs: {
        ...nodeSpecs.code_block.attrs,
        props: {
          default: toSerialized(
            getInitialPropsValue({
              kind: "object",
              fields: config.heading.schema,
            }),
            config.heading.schema,
          ),
        },
      },
    };
  }
  if (config.orderedList) {
    nodeSpecsWithCustomNodes.ordered_list = nodeSpecs.ordered_list;
  }
  if (config.unorderedList) {
    nodeSpecsWithCustomNodes.unordered_list = nodeSpecs.unordered_list;
  }
  if (config.orderedList || config.unorderedList) {
    nodeSpecsWithCustomNodes.list_item = nodeSpecs.list_item;
  }
  if (config.heading.levels.length) {
    nodeSpecsWithCustomNodes.heading = {
      attrs: {
        level: { default: config.heading.levels[0] },
        textAlign: { default: null },
        props: {
          default: toSerialized(
            getInitialPropsValue({
              kind: "object",
              fields: config.heading.schema,
            }),
            config.heading.schema,
          ),
        },
      },
      content: inlineContent,
      group: "block",
      parseDOM: config.heading.levels.map((level) => ({
        tag: "h" + level,
        getAttrs(dom: HTMLElement | string) {
          return { level, ...getTextAlignAttrs(dom) };
        },
      })),
      defining: true,
      toDOM(node) {
        return [
          "h" + node.attrs.level,
          withTextAlign({}, node.attrs.textAlign),
          0,
        ];
      },
      insertMenu: config.heading.levels.map((level, index) => ({
        ...levelsMeta[index],
        label: "Heading " + level,
        command: (type) => setBlockType(type, { level }),
      })),
    };
  }
  if (config.table) {
    const hostTypography = opts?.hostTypography ?? false;
    const elementClass = hostTypography
      ? tableHostElementClass
      : tableElementClass;
    nodeSpecsWithCustomNodes.table = {
      ...nodeSpecs.table,
      nodeView: (node) =>
        new TableColgroupNodeView(node, elementClass, hostTypography),
      toDOM(node) {
        return [
          "table",
          { class: elementClass },
          tableColgroupSpec(node),
          ["tbody", 0],
        ];
      },
    };
    nodeSpecsWithCustomNodes.table_row = nodeSpecs.table_row;
    nodeSpecsWithCustomNodes.table_cell = {
      ...nodeSpecs.table_cell,
      ...(isMDX ? { content: "paragraph" } : null),
      ...(hostTypography
        ? {
            toDOM(node: ProsemirrorNode) {
              return [
                "td",
                { class: tableHostCellClass, ...cellSpanDOMAttrs(node) },
                0,
              ] satisfies DOMOutputSpec;
            },
          }
        : null),
    };
    nodeSpecsWithCustomNodes.table_header = hostTypography
      ? {
          ...nodeSpecs.table_header,
          toDOM(node) {
            return [
              "th",
              { class: tableHostCellClass, ...cellSpanDOMAttrs(node) },
              0,
            ];
          },
        }
      : nodeSpecs.table_header;
  }
  if (config.grid) {
    nodeSpecsWithCustomNodes.grid = nodeSpecs.grid;
    nodeSpecsWithCustomNodes.grid_cell = nodeSpecs.grid_cell;
  }
  if (config.image) {
    nodeSpecsWithCustomNodes.image = nodeSpecs.image;
    // Gated on the same option as `image` (and so on the same `svg` entry in
    // content/index.tsx's allowedHtmlTags, which the AI prompt reads): both are
    // "this field can hold pictures". A field with images turned off shouldn't
    // grow a second way to embed one.
    nodeSpecsWithCustomNodes.svg = nodeSpecs.svg;
  }
  if (config.contentRef) {
    nodeSpecsWithCustomNodes.content_ref = nodeSpecs.content_ref;
  }

  const markSpecsWithCustomMarks = {
    ...getCustomMarkSpecs(components),
  };
  if (config.link) {
    markSpecsWithCustomMarks.link = markSpecs.link;
  }
  if (config.italic) {
    markSpecsWithCustomMarks.italic = markSpecs.italic;
  }
  if (config.bold) {
    markSpecsWithCustomMarks.bold = markSpecs.bold;
  }
  if (config.underline) {
    markSpecsWithCustomMarks.underline = markSpecs.underline;
  }
  if (config.strikethrough) {
    markSpecsWithCustomMarks.strikethrough = markSpecs.strikethrough;
  }
  if (config.code) {
    markSpecsWithCustomMarks.code = markSpecs.code;
  }
  if (config.fontSize) {
    markSpecsWithCustomMarks.fontSize = markSpecs.fontSize;
  }
  if (config.textColor) {
    markSpecsWithCustomMarks.textColor = markSpecs.textColor;
  }

  const schema = new Schema({
    nodes: nodeSpecsWithCustomNodes,
    marks: markSpecsWithCustomMarks,
  });

  const nodes = schema.nodes as EditorSchema["nodes"];
  const marks = schema.marks as EditorSchema["marks"];

  const editorSchema: EditorSchema = {
    schema,
    marks,
    nodes,
    config,
    components,
    insertMenuItems: [],
    format: isMDX ? "mdx" : "markdoc",
    hostTypography: opts?.hostTypography ?? false,
  };
  schemaToEditorSchema.set(schema, editorSchema);

  const insertMenuItems: Omit<InsertMenuItem, "id">[] = [];
  for (const node of Object.values(schema.nodes)) {
    const insertMenuSpec = (node.spec as EditorNodeSpec).insertMenu;
    if (insertMenuSpec) {
      if (Array.isArray(insertMenuSpec)) {
        for (const item of insertMenuSpec) {
          insertMenuItems.push({
            label: item.label,
            description: item.description,
            icon: item.icon,
            command: item.command(node, editorSchema),
            forToolbar: item.forToolbar,
          });
        }
      } else {
        insertMenuItems.push({
          label: insertMenuSpec.label,
          description: insertMenuSpec.description,
          icon: insertMenuSpec.icon,
          command: insertMenuSpec.command(node, editorSchema),
          forToolbar: insertMenuSpec.forToolbar,
        });
      }
    }
  }

  // TODO: keep "bullet list" and "ordered list" together
  editorSchema.insertMenuItems = insertMenuItems
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((item, i) => ({ ...item, id: i.toString() }));

  return editorSchema;
}

// Persisted on globalThis rather than a plain module-level `const` so the
// registry survives Vite dev re-evaluating this module. When Vite re-optimizes
// dependencies (e.g. the first time the editor's toolbar icons are discovered)
// it fires a reload that would otherwise reset this WeakMap out from under
// still-live editor values, making getEditorSchema throw "No editor schema for
// schema". In production the module evaluates once, so this is equivalent to a
// module-level WeakMap.
const globalForSchema = globalThis as unknown as {
  __drystackSchemaToEditorSchema?: WeakMap<Schema, EditorSchema>;
};
const schemaToEditorSchema = (globalForSchema.__drystackSchemaToEditorSchema ??=
  new WeakMap<Schema, EditorSchema>());

export function getEditorSchema(schema: Schema): EditorSchema {
  const editorSchema = schemaToEditorSchema.get(schema);
  if (!editorSchema) {
    throw new Error("No editor schema for schema");
  }
  return editorSchema;
}
