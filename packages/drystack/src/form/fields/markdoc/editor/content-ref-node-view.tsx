import { Node as ProseMirrorNode } from "prosemirror-model";
import { css, tokenSchema } from "@keystar/ui/style";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../app/l10n";
import { parseEditKey } from "../../../../app/edit-sync";
import { useReferencedContentHtml } from "../../../../app/content-ref/useReferencedContentHtml";

const sectionClass = css({
  display: "block",
  "&[data-selected=true]": {
    outline: `2px solid ${tokenSchema.color.alias.borderSelected}`,
    outlineOffset: 2,
  },
});

const brokenClass = css({
  display: "block",
  border: `1px dashed ${tokenSchema.color.border.critical}`,
  borderRadius: tokenSchema.size.radius.regular,
  padding: tokenSchema.size.space.regular,
  color: tokenSchema.color.foreground.critical,
});

const loadingClass = css({
  display: "block",
  padding: tokenSchema.size.space.regular,
  color: tokenSchema.color.alias.foregroundDisabled,
});

/**
 * Renders a `content_ref` node - a read-only, always-live import of another
 * singleton/collection's own top-level content field. Never editable here:
 * the node is an atom whose only editable surface is *which* entry/field it
 * points at (see popovers/content-ref.tsx), never the imported content
 * itself, which belongs to (and is only ever edited from) its source entry.
 *
 * Resolved live on every render via useReferencedContentHtml rather than any
 * value cached on the node's own attrs - the node only ever stores the
 * pointer (see schema.tsx's `content_ref` spec and html/serialize.ts, which
 * always writes back an empty placeholder). This is what makes "always the
 * latest" true in the editor; the published page gets the same freshness at
 * build time instead (see packages/astro/src/content-ref-resolve.ts).
 */
export function ContentRefNodeView(props: {
  node: ProseMirrorNode;
  hasNodeSelection: boolean;
  isNodeCompletelyWithinSelection: boolean;
  getPos: () => number | undefined;
}) {
  const { node } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const isSelected =
    props.hasNodeSelection || props.isNodeCompletelyWithinSelection;
  const parsed = parseEditKey(node.attrs.ref as string);
  const state = useReferencedContentHtml(parsed ?? null, parsed?.field ?? null);

  if (!parsed || state.status === "not-found") {
    return (
      <div className={brokenClass} contentEditable={false}>
        {stringFormatter.format("contentRefNotFound")}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className={loadingClass} contentEditable={false}>
        {stringFormatter.format("loading")}
      </div>
    );
  }

  return (
    <section
      className={sectionClass}
      data-selected={isSelected}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: state.html }}
    />
  );
}
