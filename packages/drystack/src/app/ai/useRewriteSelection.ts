import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { Slice } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";

import type { ComponentSchema } from "../../form/api";
import {
  clearAiRewriteRange,
  getAiRewriteRange,
  setAiRewriteRange,
} from "../../form/fields/markdoc/editor/ai-rewrite";
import { useEditorViewRef } from "../../form/fields/markdoc/editor/editor-view";
import { htmlToProseMirror } from "../../form/fields/markdoc/editor/html/parse";
import { serializeFromEditorStateToHTML } from "../../form/fields/markdoc/editor/html/serialize";
import { getEditorSchema } from "../../form/fields/markdoc/editor/schema";
import { useEntryDirectoryContext } from "../entry-form";
import l10nMessages from "../l10n";
import { useRouter } from "../router";
import { stripDisallowedTags } from "./apply-value";
import { fieldToContextText } from "./field-value-text";
import { stripCodeFence } from "./rewrite-html";
import { useAiModels } from "./useAiModels";
import { readErrorMessage } from "./useMagicWrite";

export type RewriteStatus = "idle" | "streaming" | "error";

export function useRewriteSelection(args: {
  entry: { kind: "collection" | "singleton"; key: string };
  /** the content field being edited - the top-level key it lives at */
  fieldKey: string;
  /** the whole entry's schema and state, for the context block */
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
}) {
  const { entry, fieldKey, schema, state } = args;
  const { basePath } = useRouter();
  const entryDirectory = useEntryDirectoryContext();
  const viewRef = useEditorViewRef();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  // Shared with the magic-write dialog: picking a model in one is picking it
  // for both.
  const model = useAiModels()?.selected;

  const [status, setStatus] = useState<RewriteStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const view = viewRef.current;
    if (view) view.dispatch(clearAiRewriteRange(view.state.tr));
    setStatus("idle");
  }, [viewRef]);

  // Leaving the entry mid-request must not keep the request (or the write it
  // would make into an editor that's gone) alive.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (description: string) => {
      const view = viewRef.current;
      if (!view) return;
      const selection = view.state.selection;
      if (!(selection instanceof TextSelection) || selection.empty) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("streaming");
      setError(undefined);

      // From here the range lives in the editor, not in this closure: the
      // request takes seconds and the user can keep typing, which moves it.
      view.dispatch(setAiRewriteRange(view.state.tr, selection.from, selection.to));

      // The passage as HTML rather than plain text: the field round-trips as
      // HTML, and dropping the markup would lose the links and emphasis the
      // rewrite is supposed to preserve.
      const passage = serializeFromEditorStateToHTML(
        view.state.doc.type.create({}, selection.content().content),
        new Map(),
        entryDirectory ?? undefined,
      );

      // Same grounding a per-field write gets: everything else in the entry,
      // so the rewrite sounds like the rest of the piece.
      const context: Record<string, string> = {};
      for (const [key, fieldSchema] of Object.entries(schema)) {
        if (key === fieldKey) continue;
        const text = fieldToContextText(fieldSchema, state[key]);
        if (text) context[key] = text;
      }

      const applyRewrite = (html: string) => {
        const latest = viewRef.current;
        if (!latest) return;
        // Not the positions captured above: whatever the user typed in the
        // meantime has moved them, and the plugin has been mapping them along.
        const range = getAiRewriteRange(latest.state);
        // The passage is gone (deleted mid-flight) - there's nothing left to
        // rewrite, and guessing where it went would corrupt the document.
        if (!range) return;

        const doc = htmlToProseMirror(
          html,
          getEditorSchema(latest.state.schema),
          new Map(),
        );
        // `Slice.maxOpen` rather than `replaceWith`: the selection is often
        // inline inside a paragraph while the model answers with block-level
        // <p>, and only an open slice can be spliced into the middle of one.
        latest.dispatch(
          latest.state.tr
            .replace(range.from, range.to, Slice.maxOpen(doc.content))
            .scrollIntoView(),
        );
      };

      try {
        const res = await fetch(`/api${basePath}/ai/rewrite`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entry,
            field: fieldKey,
            selection: passage,
            description,
            context,
            model,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setError(await readErrorMessage(res, stringFormatter));
          setStatus("error");
          return;
        }

        // Buffered rather than streamed into the document: replacing the range
        // once means the selection stays put while the model works, and a
        // single undo takes the whole rewrite back.
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let raw = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += value;
        }

        const html = stripDisallowedTags(stripCodeFence(raw));
        if (!html) {
          setError(stringFormatter.format("aiRewriteEmptyResult"));
          setStatus("error");
          return;
        }

        applyRewrite(html);
        setStatus("idle");
      } catch (err) {
        // An abort is the user pressing Stop, not a failure.
        if ((err as Error)?.name === "AbortError") {
          setStatus("idle");
        } else {
          setError(
            err instanceof Error
              ? err.message
              : stringFormatter.format("aiUnknownError"),
          );
          setStatus("error");
        }
      } finally {
        const latest = viewRef.current;
        if (latest) latest.dispatch(clearAiRewriteRange(latest.state.tr));
        abortRef.current = null;
      }
    },
    [
      basePath,
      entry,
      entryDirectory,
      fieldKey,
      model,
      schema,
      state,
      stringFormatter,
      viewRef,
    ],
  );

  // Stable: it's an effect dependency at the call site, where a fresh identity
  // each render would re-run the effect that reports the error.
  const clearError = useCallback(() => setError(undefined), []);

  return { status, error, start, abort, clearError };
}
