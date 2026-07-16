import { Fragment, Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorSchema, getEditorSchema } from '../schema';
import { textblockChildren } from '../serialize-inline';
import { MEDIA_LIBRARY_DIRECTORY } from '../../../../../app/media-library/constants';
import { imageLayoutStyleString } from '../image-layout';
import { getColumnWidthPercents } from '../table-column-resize';
import {
  cellStyleString,
  gridContainerStyle,
  GRID_RESPONSIVE_CSS,
} from '../grid';

type HtmlElementNode = {
  kind: 'element';
  tag: string;
  attrs?: Record<string, string>;
  children: HtmlNode[];
};

type HtmlNode =
  | { kind: 'text'; text: string }
  | { kind: 'fragment'; children: HtmlNode[] }
  | HtmlElementNode;

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);

function escapeHTML(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string) {
  return escapeHTML(text).replace(/"/g, '&quot;');
}

function cellSpanAttrs(node: ProseMirrorNode): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  if (node.attrs.colspan > 1) attrs.colspan = String(node.attrs.colspan);
  if (node.attrs.rowspan > 1) attrs.rowspan = String(node.attrs.rowspan);
  if (node.attrs.widthPercent) attrs.style = `width:${node.attrs.widthPercent}%`;
  return Object.keys(attrs).length ? attrs : undefined;
}

function renderNode(node: HtmlNode): string {
  if (node.kind === 'text') return escapeHTML(node.text);
  if (node.kind === 'fragment') return node.children.map(renderNode).join('');
  const attrs = node.attrs
    ? Object.entries(node.attrs)
        .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
        .join('')
    : '';
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children
    .map(renderNode)
    .join('')}</${node.tag}>`;
}

type SerializationState = {
  schema: EditorSchema;
  other: Map<string, Uint8Array>;
  // the responsive media rule for grids is emitted once per document (on the
  // first grid encountered) — see the `grid` case in `proseMirrorToHtmlNode`
  gridStyleEmitted: boolean;
  // Repo-relative directory of the entry this document belongs to (e.g.
  // `demo`, `blog/my-post`). An entry-scoped image is written to
  // `<entryDirectory>/assets/<name>` (see serialize-props.ts/save.ts), so its
  // src must be the matching public path `/<entryDirectory>/assets/<name>` to
  // resolve on the live site. Left undefined by callers that don't know the
  // directory — the src then falls back to the bare filename (still
  // round-trips through parse.ts's basename lookup, just won't render live).
  entryDirectory: string | undefined;
};

function uniqueFilename(
  existing: ReadonlyMap<string, Uint8Array>,
  filename: string
): string {
  if (!existing.has(filename)) return filename;
  const dotIndex = filename.lastIndexOf('.');
  const base = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
  const extension = dotIndex === -1 ? '' : filename.slice(dotIndex);
  let i = 1;
  let candidate = `${base}-${i}${extension}`;
  while (existing.has(candidate)) {
    i++;
    candidate = `${base}-${i}${extension}`;
  }
  return candidate;
}

function _blocks(fragment: Fragment, state: SerializationState): HtmlNode[] {
  const children: HtmlNode[] = [];
  fragment.forEach(child => {
    children.push(proseMirrorToHtmlNode(child, state));
  });
  return children;
}

function _inline(fragment: Fragment, state: SerializationState): HtmlNode[] {
  return textblockChildren<HtmlNode>(
    fragment,
    (text): HtmlNode => ({ kind: 'text', text }),
    node => getLeafContent(node, state),
    mark => getWrapperForMark(mark, state)
  );
}

function getLeafContent(
  node: ProseMirrorNode,
  state: SerializationState
): HtmlNode | undefined {
  const { schema } = state;
  if (node.type === schema.nodes.hard_break) {
    return { kind: 'element', tag: 'br', children: [] };
  }
  if (node.type === schema.nodes.image) {
    const { filename, alt, title, width, height, align } = node.attrs;
    const style = imageLayoutStyleString({ width, height, align });
    const layoutAttrs = {
      ...(align ? { 'data-align': align } : {}),
      ...(style ? { style } : {}),
    };
    if (node.attrs.src.byteLength > 0) {
      // has real bytes in-memory (freshly inserted, or an existing node the
      // user edited this session) — embed them as a sibling file scoped to
      // this entry instead of the shared media library directory
      const key = uniqueFilename(state.other, filename);
      state.other.set(key, node.attrs.src);
      return {
        kind: 'element',
        tag: 'img',
        attrs: {
          src: state.entryDirectory
            ? `/${state.entryDirectory}/assets/${key}`
            : key,
          alt: alt ?? '',
          ...(title ? { title } : {}),
          ...layoutAttrs,
        },
        children: [],
      };
    }
    // loaded from stored HTML with no embedded bytes and untouched this
    // session — keep pointing at the shared media library directory so
    // pre-existing content keeps working without a migration
    return {
      kind: 'element',
      tag: 'img',
      attrs: {
        src: `/${MEDIA_LIBRARY_DIRECTORY}/${filename}`,
        alt: alt ?? '',
        ...(title ? { title } : {}),
        ...layoutAttrs,
      },
      children: [],
    };
  }
  if (node.text !== undefined) {
    return { kind: 'text', text: node.text };
  }
}

function getWrapperForMark(
  mark: Mark,
  state: SerializationState
): HtmlElementNode | undefined {
  const { schema } = state;
  if (mark.type === schema.marks.bold) {
    return { kind: 'element', tag: 'strong', children: [] };
  }
  if (mark.type === schema.marks.italic) {
    return { kind: 'element', tag: 'em', children: [] };
  }
  if (mark.type === schema.marks.strikethrough) {
    return { kind: 'element', tag: 's', children: [] };
  }
  if (mark.type === schema.marks.underline) {
    return { kind: 'element', tag: 'u', children: [] };
  }
  if (mark.type === schema.marks.code) {
    return { kind: 'element', tag: 'code', children: [] };
  }
  if (mark.type === schema.marks.link) {
    return {
      kind: 'element',
      tag: 'a',
      attrs: {
        href: mark.attrs.href,
        ...(mark.attrs.title ? { title: mark.attrs.title } : {}),
      },
      children: [],
    };
  }
}

function textAlignAttr(
  node: ProseMirrorNode
): Record<string, string> | undefined {
  const textAlign = node.attrs.textAlign;
  return textAlign ? { style: `text-align:${textAlign}` } : undefined;
}

function proseMirrorToHtmlNode(
  node: ProseMirrorNode,
  state: SerializationState
): HtmlNode {
  const schema = getEditorSchema(node.type.schema);
  const blocks = (fragment: Fragment) => _blocks(fragment, state);
  const inline = (fragment: Fragment) => _inline(fragment, state);

  if (node.type === schema.nodes.doc) {
    return { kind: 'fragment', children: blocks(node.content) };
  }
  if (node.type === schema.nodes.paragraph) {
    return {
      kind: 'element',
      tag: 'p',
      attrs: textAlignAttr(node),
      children: inline(node.content),
    };
  }
  if (node.type === schema.nodes.blockquote) {
    return {
      kind: 'element',
      tag: 'blockquote',
      children: blocks(node.content),
    };
  }
  if (node.type === schema.nodes.divider) {
    return { kind: 'element', tag: 'hr', children: [] };
  }
  if (node.type === schema.nodes.heading) {
    return {
      kind: 'element',
      tag: `h${node.attrs.level}`,
      attrs: textAlignAttr(node),
      children: inline(node.content),
    };
  }
  if (node.type === schema.nodes.code_block) {
    const codeAttrs =
      typeof node.attrs.language === 'string' && node.attrs.language
        ? { 'data-language': node.attrs.language }
        : undefined;
    return {
      kind: 'element',
      tag: 'pre',
      children: [
        {
          kind: 'element',
          tag: 'code',
          attrs: codeAttrs,
          children: [
            { kind: 'text', text: node.textBetween(0, node.content.size) },
          ],
        },
      ],
    };
  }
  if (node.type === schema.nodes.list_item) {
    return { kind: 'element', tag: 'li', children: blocks(node.content) };
  }
  if (node.type === schema.nodes.ordered_list) {
    return {
      kind: 'element',
      tag: 'ol',
      attrs: node.attrs.start !== 1 ? { start: String(node.attrs.start) } : undefined,
      children: blocks(node.content),
    };
  }
  if (node.type === schema.nodes.unordered_list) {
    return { kind: 'element', tag: 'ul', children: blocks(node.content) };
  }
  if (node.type === schema.nodes.table) {
    const rows: ProseMirrorNode[] = [];
    node.content.forEach(row => rows.push(row));
    const hasHeaderRow = rows[0]?.firstChild?.type === schema.nodes.table_header;
    const theadRows = hasHeaderRow ? [rows[0]] : [];
    const tbodyRows = hasHeaderRow ? rows.slice(1) : rows;
    const children: HtmlNode[] = [];
    children.push({
      kind: 'element',
      tag: 'colgroup',
      children: getColumnWidthPercents(node).map(
        (pct): HtmlNode => ({
          kind: 'element',
          tag: 'col',
          attrs: pct != null ? { style: `width:${pct}%` } : undefined,
          children: [],
        })
      ),
    });
    if (theadRows.length) {
      children.push({
        kind: 'element',
        tag: 'thead',
        children: theadRows.map(row => proseMirrorToHtmlNode(row, state)),
      });
    }
    children.push({
      kind: 'element',
      tag: 'tbody',
      children: tbodyRows.map(row => proseMirrorToHtmlNode(row, state)),
    });
    // The editor styles the table via `tableElementClass` (width:100% +
    // table-layout:fixed), but that's a Keystar `css()` class whose rules only
    // exist in the admin's injected stylesheet — the published page has no such
    // rule, so a bare <table> there would shrink to its content and ignore the
    // <col> percentages. Emit the two load-bearing properties inline so the
    // real UI (and the visual editor's inline spots reading this HTML back)
    // lay the table out exactly like the admin editor does.
    return {
      kind: 'element',
      tag: 'table',
      attrs: { style: 'width:100%;table-layout:fixed' },
      children,
    };
  }
  if (node.type === schema.nodes.table_row) {
    return { kind: 'element', tag: 'tr', children: blocks(node.content) };
  }
  if (node.type === schema.nodes.table_header) {
    return { kind: 'element', tag: 'th', attrs: cellSpanAttrs(node), children: blocks(node.content) };
  }
  if (node.type === schema.nodes.table_cell) {
    return { kind: 'element', tag: 'td', attrs: cellSpanAttrs(node), children: blocks(node.content) };
  }
  if (node.type === schema.nodes.grid) {
    // grab-then-set before serializing children so a nested grid sees the
    // flag already set and doesn't emit a second copy of the media rule
    const emitStyle = !state.gridStyleEmitted;
    state.gridStyleEmitted = true;
    const gridDiv: HtmlNode = {
      kind: 'element',
      tag: 'div',
      attrs: {
        'data-dry-grid': '',
        style: gridContainerStyle(node.attrs.gap, node.attrs.columns),
      },
      children: blocks(node.content),
    };
    if (!emitStyle) return gridDiv;
    // `<style>` in the body is `display:none` and inert layout-wise, so it's
    // safe to sit next to the grid; it carries the mobile "1 column" rule
    return {
      kind: 'fragment',
      children: [
        {
          kind: 'element',
          tag: 'style',
          children: [{ kind: 'text', text: GRID_RESPONSIVE_CSS }],
        },
        gridDiv,
      ],
    };
  }
  if (node.type === schema.nodes.grid_cell) {
    return {
      kind: 'element',
      tag: 'div',
      attrs: {
        'data-dry-cell': '',
        style: cellStyleString({ span: node.attrs.span, place: node.attrs.place }),
      },
      children: blocks(node.content),
    };
  }

  throw new Error(`Unhandled node type: ${node.type.name}`);
}

export function serializeFromEditorStateToHTML(
  node: ProseMirrorNode,
  other: Map<string, Uint8Array>,
  entryDirectory?: string
): string {
  const state: SerializationState = {
    schema: getEditorSchema(node.type.schema),
    other,
    gridStyleEmitted: false,
    entryDirectory,
  };
  return renderNode(proseMirrorToHtmlNode(node, state));
}
