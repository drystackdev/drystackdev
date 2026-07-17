import { useCallback, useEffect, useRef, useState } from "react";

import {
  useLocalizedStringFormatter,
  type LocalizedStringFormatter,
} from "@react-aria/i18n";
import { toastQueue } from "@keystar/ui/toast";

import type { ComponentSchema } from "../../form/api";
import type { AiSize } from "../../api/ai/prompt";
import { describeFields } from "../../api/ai/schema-to-yaml";
import l10nMessages from "../l10n";
import { useRouter } from "../router";
import { aiValueToFormValue } from "./apply-value";
import { localizeAiConfigError } from "./ai-config-error-message";
import { AiStreamParser } from "./stream-parser";
import { useAiModels } from "./useAiModels";

// Re-parsing a whole ProseMirror document on every token would make long
// articles crawl, so content fields repaint on a timer instead. Short enough
// to still read as typing.
const CONTENT_REPAINT_MS = 120;

export type MagicWriteStatus = "idle" | "streaming" | "error";

export type MagicWriteRequest = {
  targets: string[];
  context: Record<string, string>;
  description: string;
  size: AiSize;
};

export function useMagicWrite(args: {
  entry: { kind: "collection" | "singleton"; key: string };
  schema: Record<string, ComponentSchema>;
  onStateChange: (
    updater: (state: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
}) {
  const { entry, schema, onStateChange } = args;
  const { basePath } = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  // `undefined` means "whatever the server would pick" - the picker's own
  // default, and what every request sent before there was a picker.
  const model = useAiModels()?.selected;

  const [status, setStatus] = useState<MagicWriteStatus>("idle");
  // Errors are toasted, not returned for a page to render: a write is started
  // from a dialog that's already closed by the time anything can fail, and the
  // form underneath is long enough that a banner pinned to the top of it can
  // fail off-screen. Same reasoning as the selection rewrite.
  const reportError = useCallback((message: string) => {
    toastQueue.critical(message, { timeout: 8000 });
  }, []);
  // Fields the model is still writing. A field leaves this set the moment its
  // value is final, so it unlocks without waiting for the rest of the stream.
  const [streamingKeys, setStreamingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingKeys(new Set());
    setStatus("idle");
  }, []);

  // Leaving the entry mid-stream must not keep the request (or the writes it
  // would make into a form that's gone) alive.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (request: MagicWriteRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("streaming");
      setStreamingKeys(new Set(request.targets));

      const specs = describeFields(schema).filter((s) =>
        request.targets.includes(s.key),
      );
      const specByKey = new Map(specs.map((s) => [s.key, s]));

      // Only scalars stream character by character; block kinds stay hidden
      // until parsed, so there's nothing to repaint for them.
      const pendingText = new Map<string, string>();
      let repaintTimer: ReturnType<typeof setTimeout> | undefined;

      const flushText = () => {
        repaintTimer = undefined;
        if (!pendingText.size) return;
        const batch = [...pendingText.entries()];
        pendingText.clear();
        onStateChange((state) => {
          const next = { ...state };
          for (const [key, text] of batch) {
            const spec = specByKey.get(key);
            if (!spec) continue;
            const value = aiValueToFormValue(spec, schema[key], text);
            if (value !== undefined) next[key] = value;
          }
          return next;
        });
      };

      const scheduleFlush = (immediate: boolean) => {
        if (immediate) {
          if (repaintTimer) clearTimeout(repaintTimer);
          flushText();
          return;
        }
        if (repaintTimer === undefined) {
          repaintTimer = setTimeout(flushText, CONTENT_REPAINT_MS);
        }
      };

      const parser = new AiStreamParser(request.targets, (event) => {
        if (event.type === "field-progress") {
          pendingText.set(event.key, event.text);
          scheduleFlush(false);
          return;
        }
        if (event.type === "field-done") {
          // Flush anything buffered for other fields first, so this field's
          // final write can't be undone by a stale batch landing after it.
          scheduleFlush(true);
          const spec = specByKey.get(event.key);
          if (spec && event.raw !== undefined) {
            const value = aiValueToFormValue(
              spec,
              schema[event.key],
              event.raw,
            );
            if (value !== undefined) {
              onStateChange((state) => ({ ...state, [event.key]: value }));
            }
          }
          setStreamingKeys((prev) => {
            const next = new Set(prev);
            next.delete(event.key);
            return next;
          });
          return;
        }
        if (event.type === "error") {
          // One unreadable block shouldn't discard the fields around it.
          reportError(
            stringFormatter.format("aiYamlParseError", {
              key: event.key,
              detail: event.detail,
            }),
          );
        }
      });

      try {
        const res = await fetch(`/api${basePath}/ai/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entry, ...request, model }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const message = await readErrorMessage(res, stringFormatter);
          reportError(message);
          setStatus("error");
          setStreamingKeys(new Set());
          return;
        }

        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.write(value);
        }
        parser.end();
        scheduleFlush(true);
        setStatus("idle");
      } catch (err) {
        // An abort is the user pressing Stop, not a failure - whatever was
        // written so far stays.
        if ((err as Error)?.name === "AbortError") {
          setStatus("idle");
        } else {
          reportError(
            err instanceof Error
              ? err.message
              : stringFormatter.format("aiUnknownError"),
          );
          setStatus("error");
        }
      } finally {
        if (repaintTimer) clearTimeout(repaintTimer);
        setStreamingKeys(new Set());
        abortRef.current = null;
      }
    },
    [basePath, entry, model, reportError, schema, onStateChange],
  );

  return {
    // Exposed so a selection rewrite, which reaches the entry only through
    // this hook's context, can address the same entry without every page
    // having to pass it down a second time.
    entry,
    status,
    streamingKeys,
    start,
    abort,
  };
}

export async function readErrorMessage(
  res: Response,
  stringFormatter: LocalizedStringFormatter,
): Promise<string> {
  try {
    const data = await res.json();
    // A config error (missing/invalid env vars) carries a stable `reason` the
    // client can localize; other server errors only have a Vietnamese
    // `error` string today, so those still pass through as-is.
    if (typeof data?.reason === "string") {
      return localizeAiConfigError(stringFormatter, data);
    }
    if (typeof data?.error === "string") return data.error;
  } catch {
    // Not JSON - fall through to the status line.
  }
  return stringFormatter.format("aiRequestFailed", { status: res.status });
}
