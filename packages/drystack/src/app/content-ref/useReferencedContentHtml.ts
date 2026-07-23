import { useEffect, useState } from "react";
import { useConfig } from "../shell/context";
import { useTree } from "../shell/data";
import { useRouter } from "../router";
import { fetchBlob } from "../useItemData";
import { getTreeNodeAtPath } from "../trees";
import { loadDataFile } from "../required-files";
import { entryRefExists, resolveEntryRef, type EntryRef } from "../path-utils";
import { editKey, entryRefKey } from "../edit-sync";
import { isContentEditorField } from "../../form/fields/content/is-content-field";
import type { AssetsFormField } from "../../form/api";
import { cacheReferencedContentHtml } from "./resolved-html-cache";

export type ReferencedContentHtmlState =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "not-found" };

const textDecoder = new TextDecoder();

// Raw HTML of another (not necessarily currently-open) entry's own top-level
// content field, resolved live from the in-memory tree - never a snapshot
// taken at insert time. Used both by the "Import content" picker (to check a
// candidate field doesn't already contain another content-ref, the
// no-nested-imports rule) and by ContentRefNodeView (to render the current
// value while editing). Deliberately returns a raw string, not a parsed
// EditorState - re-parsing to ProseMirror just to read it back out as a
// string would be wasted work and would invite re-scanning the fetched HTML
// for nested refs, which the picker's own filtering already rules out.
export function useReferencedContentHtml(
  ref: EntryRef | null,
  field: string | null,
  // Pre-resolved HTML to paint immediately, before this hook's own fetch
  // resolves - see schema.tsx's content_ref.seedHtml. Only ever non-null on
  // a live page (VEI), where the server has already resolved it; the admin
  // editor always calls this without one and shows the loading state as
  // before.
  seedHtml?: string | null,
): ReferencedContentHtmlState {
  const config = useConfig();
  const { basePath } = useRouter();
  const tree = useTree().current;

  const [state, setState] = useState<ReferencedContentHtmlState>(() =>
    seedHtml != null ? { status: "ready", html: seedHtml } : { status: "loading" },
  );

  const refKey = ref ? entryRefKey(ref) : null;

  // Seed the cache from the server-resolved HTML too (not just the fetches
  // below) - an unmount-repaint (see InlineContentEditors.tsx) racing ahead
  // of the live fetch below still has *something* correct to fall back on.
  useEffect(() => {
    if (ref && field && seedHtml != null) {
      cacheReferencedContentHtml(editKey(ref, field), seedHtml);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey, field, seedHtml]);

  useEffect(() => {
    if (!ref || !field || tree.kind !== "loaded") {
      setState({ status: "not-found" });
      return;
    }
    if (!entryRefExists(config, ref)) {
      setState({ status: "not-found" });
      return;
    }
    let cancelled = false;
    // Keep whatever's already on screen (the seed, or a previous fetch's
    // result) while resolving live in the background instead of flashing
    // back to "loading" - the seed in particular is already correct as of
    // the last server render, so there's nothing to hide it for.
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    (async () => {
      const resolved = resolveEntryRef(config, ref);
      const fieldSchema = resolved.schema[field];
      if (!fieldSchema || !isContentEditorField(fieldSchema)) {
        if (!cancelled) setState({ status: "not-found" });
        return;
      }
      const contentExtension = (fieldSchema as AssetsFormField<any, any, any>)
        .contentExtension;
      const path = contentExtension
        ? `${resolved.dir}/${field}${contentExtension}`
        : resolved.dataFilepath;
      const sha = getTreeNodeAtPath(tree.data.tree, path)?.entry.sha;
      if (!sha) {
        if (!cancelled) setState({ status: "not-found" });
        return;
      }
      const bytes = await fetchBlob(config, sha, path, basePath);
      if (cancelled) return;
      if (contentExtension) {
        const html = textDecoder.decode(bytes);
        cacheReferencedContentHtml(editKey(ref, field), html);
        setState({ status: "ready", html });
        return;
      }
      // inline field: the html string lives directly in the data file's own
      // JSON/YAML under this field's key
      const { loaded } = loadDataFile(bytes, resolved.format);
      const html = (loaded as Record<string, unknown> | null)?.[field];
      if (typeof html === "string") {
        cacheReferencedContentHtml(editKey(ref, field), html);
        setState({ status: "ready", html });
      } else {
        setState({ status: "not-found" });
      }
    })().catch(() => {
      if (!cancelled) setState({ status: "not-found" });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, refKey, field, tree, basePath]);

  return state;
}
