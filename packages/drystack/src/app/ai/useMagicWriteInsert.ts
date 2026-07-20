import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { Slice } from "prosemirror-model";

import type { ComponentSchema } from "../../form/api";
import { describeField } from "../../api/ai/schema-to-yaml";
import {
  clearAiRewriteRange,
  getAiInsertPoint,
  setAiInsertPoint,
} from "../../form/fields/markdoc/editor/ai-rewrite";
import { useEditorViewRef } from "../../form/fields/markdoc/editor/editor-view";
import { htmlToProseMirror } from "../../form/fields/markdoc/editor/html/parse";
import { getEditorSchema } from "../../form/fields/markdoc/editor/schema";
import l10nMessages from "../l10n";
import { useRouter } from "../router";
import { useConfig } from "../shell/context";
import { stripDisallowedTags } from "./apply-value";
import { AiStreamParser } from "./stream-parser";
import { readErrorMessage } from "./useMagicWrite";
import { useAiModels } from "./useAiModels";
import { aiRouteUrl, aiRouteModel } from "./ai-fetch";

export type MagicWriteInsertStatus = "idle" | "streaming" | "error";

/**
 * Sibling to useMagicWrite, for the one generate outcome that isn't a
 * whole-field replace: splicing fresh content in at the cursor (or the
 * document's end) instead of discarding what's already there. Talks to the
 * same "generate" endpoint and YAML-stream shape, but applies the result
 * itself, straight to the live ProseMirror view, rather than handing a value
 * back through the entry's form state - the insertion point has to survive
 * whatever the user types while the request is in flight, the same way a
 * passage rewrite's range does (see ai-rewrite.ts / useRewriteSelection).
 */
export function useMagicWriteInsert(args: {
  entry: { kind: "collection" | "singleton"; key: string };
  fieldKey: string;
  schema: Record<string, ComponentSchema>;
}) {
  const { entry, fieldKey, schema } = args;
  const { basePath } = useRouter();
  const config = useConfig();
  const viewRef = useEditorViewRef();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  // Shared with the magic-write dialog and the selection rewrite: picking a
  // model in one is picking it for all three.
  const model = useAiModels()?.selected;

  const [status, setStatus] = useState<MagicWriteInsertStatus>("idle");
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
      const spec = describeField(fieldKey, schema[fieldKey]);
      if (!view || !spec) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("streaming");
      setError(undefined);

      // From here the point lives in the editor, not in this closure: the
      // request takes seconds and the user can keep typing, which moves it.
      const pos = view.state.selection.head;
      view.dispatch(setAiInsertPoint(view.state.tr, pos));

      let raw: string | undefined;
      const parser = new AiStreamParser([fieldKey], (event) => {
        if (event.type === "field-done" && typeof event.raw === "string") {
          raw = event.raw;
        }
      });

      try {
        const res = await fetch(aiRouteUrl(config, basePath, "generate"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entry,
            targets: [fieldKey],
            context: {},
            description,
            // No size picker for this flow - the server defaults a missing
            // content target to "medium" (see resolveSizes in api/ai/index.ts).
            sizes: {},
            seeds: {},
            model: aiRouteModel(config, model),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setError(await readErrorMessage(res, stringFormatter));
          setStatus("error");
          return;
        }

        // Buffered rather than streamed into the document: the same
        // reasoning as a passage rewrite - one splice keeps the insertion
        // point stable and a single undo takes the whole write back.
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.write(value);
        }
        parser.end();

        if (!raw) {
          setError(stringFormatter.format("aiRewriteEmptyResult"));
          setStatus("error");
          return;
        }

        const latest = viewRef.current;
        if (!latest) return;
        // Not the position captured above: whatever the user typed in the
        // meantime has moved it, and the plugin has been mapping it along.
        // Falls back to the document's end if the point is gone entirely
        // (e.g. a select-all replaced the whole doc mid-flight).
        const insertPos =
          getAiInsertPoint(latest.state) ?? latest.state.doc.content.size;

        // No `<svg>` handling here: the live editor's own schema decides.
        // Where it has the `svg` node the parser keeps the drawing as inline,
        // sanitized markup; where it doesn't, the drawing is dropped. Same as
        // the fill flow - see apply-value.ts's `content` case.
        const doc = htmlToProseMirror(
          stripDisallowedTags(raw),
          getEditorSchema(latest.state.schema),
          new Map(),
        );
        // `Slice.maxOpen` rather than `insert`: the cursor is often inline
        // inside a paragraph while the model answers with block-level <p>,
        // and only an open slice can be spliced into the middle of one.
        latest.dispatch(
          latest.state.tr
            .replace(insertPos, insertPos, Slice.maxOpen(doc.content))
            .scrollIntoView(),
        );
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
    [basePath, config, entry, fieldKey, model, schema, stringFormatter, viewRef],
  );

  // Stable: it's an effect dependency at the call site, where a fresh
  // identity each render would re-run the effect that reports the error.
  const clearError = useCallback(() => setError(undefined), []);

  return { status, error, start, abort, clearError };
}
