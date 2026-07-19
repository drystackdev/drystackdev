import { MarkType, Node as ProseMirrorNode } from "prosemirror-model";
import { EditorSchema, TEXT_ALIGN_VALUES } from "../schema";
import { MEDIA_LIBRARY_DIRECTORY } from "../../../../../app/media-library/constants";
import { imageLayoutFromElement } from "../image-layout";
import {
  parseGridColumnSpan,
  parseGridColumns,
  parseGridRowSpan,
  parsePlaceContent,
  parseGridGap,
  parseGridRows,
} from "../grid";

type ParseState = {
  schema: EditorSchema;
  other: ReadonlyMap<string, Uint8Array>;
};

// legacy images (saved before per-entry image storage existed) are stored by
// reference (a path into the shared media library directory), not embedded
// bytes. the shared `image` node view resolves the real bytes lazily via
// `resolveMediaLibraryBytes` (see schema.tsx) when it notices this sentinel.
const UNHYDRATED_IMAGE_BYTES = new Uint8Array(0);

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "ul",
  "ol",
  "pre",
  "table",
]);

function isBlockTag(tag: string) {
  return BLOCK_TAGS.has(tag);
}

// A heading tag the field doesn't allow - an `<h1>` in a `content` field, whose
// headings start at h2 - still has to land somewhere. Demote it to the closest
// level that is allowed: the editor never offers the level in its block menu, so
// keeping it would let the tag round-trip straight back out on save. Paste goes
// through ProseMirror's own DOMParser, which drops it for the same reason.
function allowedHeadingLevel(level: number, schema: EditorSchema) {
  const levels = schema.config.heading.levels;
  if (!levels.length || levels.includes(level as (typeof levels)[number])) {
    return level;
  }
  return levels.reduce((closest, candidate) =>
    Math.abs(candidate - level) < Math.abs(closest - level)
      ? candidate
      : closest,
  );
}

function textAlignFromElement(el: Element): string | null {
  const textAlign = (el as HTMLElement).style?.textAlign;
  return textAlign && TEXT_ALIGN_VALUES.has(textAlign) ? textAlign : null;
}

// Shared by both the plain `<img>` case (inline, no caption) and the
// `<figure><img>...<figcaption>` case (see the "figure" branch in
// `blocksFromChildNodes`) - the only difference is the caption text.
function imageFromElement(
  el: Element,
  state: ParseState,
  caption: string,
): ProseMirrorNode | null {
  const { schema } = state;
  if (!schema.nodes.image) return null;
  const src = el.getAttribute("src") ?? "";
  const prefix = `/${MEDIA_LIBRARY_DIRECTORY}/`;
  const isLegacyLibraryReference = src.startsWith(prefix);
  const decoded = decodeURIComponent(
    isLegacyLibraryReference ? src.slice(prefix.length) : src,
  );
  if (!decoded) return null;
  // The serializer writes an entry-scoped image's src as a public path
  // (`/<entryDir>/assets/<name>`, see serialize.ts) so it resolves on the
  // live site, but `other` is keyed by the bare filename - so hydrate by
  // basename. This also tolerates older/looser prefixes (e.g. `/assets/…`).
  const filename = isLegacyLibraryReference
    ? decoded
    : decoded.slice(decoded.lastIndexOf("/") + 1);
  if (!filename) return null;
  // legacy images keep resolving lazily via `resolveMediaLibraryBytes`
  // (see schema.tsx); new images are resolved synchronously here from
  // this entry's own sibling files
  const content = isLegacyLibraryReference
    ? UNHYDRATED_IMAGE_BYTES
    : (state.other.get(filename) ?? UNHYDRATED_IMAGE_BYTES);
  const layout = imageLayoutFromElement(el as HTMLElement);
  return schema.nodes.image.createChecked({
    src: content,
    // Verbatim, so an untouched image serializes back to the exact src it
    // came in with, and so the node view has something to render when
    // `content` is unhydrated.
    srcUrl: src,
    filename,
    alt: el.getAttribute("alt") ?? "",
    title: el.getAttribute("title") ?? "",
    width: layout.width,
    height: layout.height,
    align: layout.align,
    caption,
  });
}

function inlineNodeToProseMirror(
  node: ChildNode,
  state: ParseState,
  marks: readonly import("prosemirror-model").Mark[],
): ProseMirrorNode[] {
  const { schema } = state;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) return [];
    return [schema.schema.text(text, marks as any)];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    if (!schema.nodes.hard_break) return [];
    return [schema.nodes.hard_break.create()];
  }
  if (tag === "img") {
    const image = imageFromElement(el, state, "");
    return image ? [image] : [];
  }

  let markType: MarkType | undefined;
  let markAttrs: Record<string, unknown> = {};
  if ((tag === "strong" || tag === "b") && schema.marks.bold) {
    markType = schema.marks.bold;
  } else if ((tag === "em" || tag === "i") && schema.marks.italic) {
    markType = schema.marks.italic;
  } else if (tag === "s" && schema.marks.strikethrough) {
    markType = schema.marks.strikethrough;
  } else if (tag === "u" && schema.marks.underline) {
    markType = schema.marks.underline;
  } else if (tag === "code" && schema.marks.code) {
    markType = schema.marks.code;
  } else if (tag === "a" && schema.marks.link) {
    markType = schema.marks.link;
    markAttrs = {
      href: el.getAttribute("href") ?? "",
      title: el.getAttribute("title") ?? "",
    };
  }

  const childMarks = markType
    ? markType.create(markAttrs).addToSet(marks)
    : marks;
  return Array.from(el.childNodes).flatMap((child) =>
    inlineNodeToProseMirror(child, state, childMarks),
  );
}

function inlineChildren(el: Element, state: ParseState): ProseMirrorNode[] {
  return Array.from(el.childNodes).flatMap((child) =>
    inlineNodeToProseMirror(child, state, []),
  );
}

function elementToBlockNode(
  el: Element,
  state: ParseState,
): ProseMirrorNode | null {
  const { schema } = state;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "p":
      return schema.nodes.paragraph
        ? schema.nodes.paragraph.createAndFill(
            { textAlign: textAlignFromElement(el) },
            inlineChildren(el, state),
          )
        : null;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return schema.nodes.heading
        ? schema.nodes.heading.createAndFill(
            {
              level: allowedHeadingLevel(Number(tag[1]), schema),
              textAlign: textAlignFromElement(el),
            },
            inlineChildren(el, state),
          )
        : null;
    case "blockquote":
      return schema.nodes.blockquote
        ? schema.nodes.blockquote.createAndFill({}, blockChildren(el, state))
        : null;
    case "hr":
      return schema.nodes.divider
        ? schema.nodes.divider.createAndFill({})
        : null;
    case "ul":
      return schema.nodes.unordered_list
        ? schema.nodes.unordered_list.createAndFill({}, listItems(el, state))
        : null;
    case "ol": {
      if (!schema.nodes.ordered_list) return null;
      const startAttr = el.getAttribute("start");
      const start = startAttr ? parseInt(startAttr, 10) : 1;
      return schema.nodes.ordered_list.createAndFill(
        { start: Number.isNaN(start) ? 1 : start },
        listItems(el, state),
      );
    }
    case "pre": {
      if (!schema.nodes.code_block) return null;
      const codeEl = el.querySelector("code");
      const language = codeEl?.getAttribute("data-language") ?? "";
      const text = (codeEl ?? el).textContent ?? "";
      return schema.nodes.code_block.createAndFill(
        { language },
        text ? schema.schema.text(text) : undefined,
      );
    }
    case "table":
      return tableFromElement(el, state, "");
    default:
      return null;
  }
}

// Shared by both the plain `<table>` case (no caption) and the
// `<figure><table>...<figcaption>` case (see the "figure" branch in
// `blocksFromChildNodes`) - the only difference is the caption text.
function tableFromElement(
  el: Element,
  state: ParseState,
  caption: string,
): ProseMirrorNode | null {
  const { schema } = state;
  if (!schema.nodes.table) return null;
  const rows: ProseMirrorNode[] = [];
  for (const section of Array.from(el.children)) {
    const sectionTag = section.tagName.toLowerCase();
    if (sectionTag === "thead" || sectionTag === "tbody") {
      for (const rowEl of Array.from(section.children)) {
        const row = tableRow(rowEl, state);
        if (row) rows.push(row);
      }
    } else if (sectionTag === "tr") {
      const row = tableRow(section, state);
      if (row) rows.push(row);
    }
  }
  return schema.nodes.table.createAndFill({ caption }, rows);
}

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

function cellSpanAttrs(el: Element) {
  const colspan = parseInt(el.getAttribute("colspan") ?? "", 10);
  const rowspan = parseInt(el.getAttribute("rowspan") ?? "", 10);
  return {
    colspan: Number.isInteger(colspan) && colspan > 0 ? colspan : 1,
    rowspan: Number.isInteger(rowspan) && rowspan > 0 ? rowspan : 1,
    widthPercent: widthPercentFromStyle(el.getAttribute("style") ?? ""),
  };
}

function tableRow(el: Element, state: ParseState): ProseMirrorNode | null {
  const { schema } = state;
  if (!schema.nodes.table_row) return null;
  const cells: ProseMirrorNode[] = [];
  for (const cellEl of Array.from(el.children)) {
    const cellTag = cellEl.tagName.toLowerCase();
    if (cellTag === "th" && schema.nodes.table_header) {
      const cell = schema.nodes.table_header.createAndFill(
        cellSpanAttrs(cellEl),
        blockChildren(cellEl, state),
      );
      if (cell) cells.push(cell);
    } else if (cellTag === "td" && schema.nodes.table_cell) {
      const cell = schema.nodes.table_cell.createAndFill(
        cellSpanAttrs(cellEl),
        blockChildren(cellEl, state),
      );
      if (cell) cells.push(cell);
    }
  }
  return schema.nodes.table_row.createAndFill(
    { heightPx: heightPxFromStyle(el.getAttribute("style") ?? "") },
    cells,
  );
}

function gridFromElement(
  el: Element,
  state: ParseState,
  caption: string = "",
): ProseMirrorNode | null {
  const { schema } = state;
  if (!schema.nodes.grid || !schema.nodes.grid_cell) return null;
  const gridStyle = el.getAttribute("style") ?? "";
  const columns = parseGridColumns(gridStyle);
  const rows = parseGridRows(gridStyle);
  const cells: ProseMirrorNode[] = [];
  for (const child of Array.from(el.children)) {
    if (
      child.tagName.toLowerCase() !== "div" ||
      !child.hasAttribute("data-dry-cell")
    ) {
      continue;
    }
    const style = child.getAttribute("style") ?? "";
    const cell = schema.nodes.grid_cell.createAndFill(
      {
        span: parseGridColumnSpan(style, columns),
        rowSpan: parseGridRowSpan(style, rows),
        place: parsePlaceContent(style),
      },
      blockChildren(child, state),
    );
    if (cell) cells.push(cell);
  }
  if (!cells.length) return null;
  const gap = parseGridGap(gridStyle);
  return schema.nodes.grid.createAndFill({ gap, columns, rows, caption }, cells);
}

function blocksFromChildNodes(
  nodes: ChildNode[],
  state: ParseState,
): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  let pendingInline: ProseMirrorNode[] = [];
  const flush = () => {
    if (pendingInline.length && state.schema.nodes.paragraph) {
      const p = state.schema.nodes.paragraph.createAndFill({}, pendingInline);
      if (p) result.push(p);
    }
    pendingInline = [];
  };
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      // never let stylesheet/script text leak into content - the grid's
      // responsive rule rides along as a sibling <style> (see the serializer)
      if (tag === "style" || tag === "script") continue;
      if (tag === "div" && el.hasAttribute("data-dry-grid")) {
        flush();
        if (state.schema.nodes.grid && state.schema.nodes.grid_cell) {
          const grid = gridFromElement(el, state);
          if (grid) result.push(grid);
        } else {
          // grid disabled in this config - unwrap rather than drop content
          result.push(...blockChildren(el, state));
        }
        continue;
      }
      // The serializer's counterpart to this block: an image/table/grid with
      // a caption gets wrapped in `<figure>…<figcaption>` (see
      // html/serialize.ts's `figureWrap`). Unwrap it back to the inner
      // node with its `caption` attr set, rather than falling through to
      // `isBlockTag`/`inlineNodeToProseMirror` below, which don't know this
      // tag at all and would drop it.
      if (tag === "figure") {
        flush();
        const children = Array.from(el.children);
        const caption =
          children.find((child) => child.tagName.toLowerCase() === "figcaption")
            ?.textContent ?? "";
        const contentEl = children.find(
          (child) => child.tagName.toLowerCase() !== "figcaption",
        );
        if (contentEl) {
          const contentTag = contentEl.tagName.toLowerCase();
          if (contentTag === "img") {
            const image = imageFromElement(contentEl, state, caption);
            if (image) pendingInline.push(image);
          } else if (contentTag === "table") {
            const table = tableFromElement(contentEl, state, caption);
            if (table) result.push(table);
          } else if (
            contentTag === "div" &&
            contentEl.hasAttribute("data-dry-grid") &&
            state.schema.nodes.grid &&
            state.schema.nodes.grid_cell
          ) {
            const grid = gridFromElement(contentEl, state, caption);
            if (grid) result.push(grid);
          }
        }
        continue;
      }
      if (isBlockTag(tag)) {
        flush();
        const block = elementToBlockNode(el, state);
        if (block) result.push(block);
        continue;
      }
    } else if (
      node.nodeType === Node.TEXT_NODE &&
      !(node.textContent ?? "").trim()
    ) {
      continue;
    }
    pendingInline.push(...inlineNodeToProseMirror(node, state, []));
  }
  flush();
  return result;
}

function blockChildren(el: Element, state: ParseState): ProseMirrorNode[] {
  return blocksFromChildNodes(Array.from(el.childNodes), state);
}

// Legacy on-disk data for inline-only fields was written by the old
// block-mode schema, which always wrapped bare inline content in <p> (see
// blocksFromChildNodes' flush()) - so a <p> boundary here is really just a
// soft line break the author intended. Unwrap the tag, keep its inline
// content (marks and all), and turn the boundary *between* legacy blocks
// into an explicit hard break, matching what Shift+Enter produces directly.
function inlineOnlyChildren(
  nodes: ChildNode[],
  state: ParseState,
): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  let sawBlock = false;
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === "style" || tag === "script") continue;
      if (isBlockTag(tag)) {
        if (sawBlock && state.schema.nodes.hard_break) {
          result.push(state.schema.nodes.hard_break.create());
        }
        result.push(...inlineChildren(el, state));
        sawBlock = true;
        continue;
      }
    } else if (
      node.nodeType === Node.TEXT_NODE &&
      !(node.textContent ?? "").trim()
    ) {
      continue;
    }
    result.push(...inlineNodeToProseMirror(node, state, []));
  }
  return result;
}

function listItems(el: Element, state: ParseState): ProseMirrorNode[] {
  const { schema } = state;
  if (!schema.nodes.list_item) return [];
  const items: ProseMirrorNode[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const item = schema.nodes.list_item.createAndFill(
      {},
      blockChildren(child, state),
    );
    if (item) items.push(item);
  }
  return items;
}

export function htmlToProseMirror(
  html: string,
  schema: EditorSchema,
  other: ReadonlyMap<string, Uint8Array>,
): ProseMirrorNode {
  const state: ParseState = { schema, other };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const children = schema.config.inlineOnly
    ? inlineOnlyChildren(Array.from(doc.body.childNodes), state)
    : blocksFromChildNodes(Array.from(doc.body.childNodes), state);
  const node = schema.nodes.doc!.createAndFill({}, children);
  if (!node) {
    throw new Error("Invalid content for document");
  }
  return node;
}
