// Which column each field starts in, and which cells of its row are live.
//
// Kept out of the dialog so it can be tested as the table of rules it is,
// rather than by rendering a grid and reading checkboxes back out.

import type { ComponentSchema } from "../../form/api";
import type { AiFieldSpec } from "../../api/ai/schema-to-yaml";
import { isFieldEmpty } from "./field-value-text";

/**
 * `none` is a real choice, not a missing one: a field can be neither context
 * nor a target, and the AI should then act as though it isn't there.
 */
export type Column = "context" | "fill" | "none";

/**
 * Whether "tiếp tục" applies to this field.
 *
 * Only array and object: continuing means keeping what's written and filling
 * the gaps around it, which needs a value with gaps in it. A half-written
 * scalar has no gaps - it's just a string the model would rewrite anyway.
 */
export function isContinuableKind(spec: AiFieldSpec): boolean {
  return spec.kind === "array" || spec.kind === "object";
}

/**
 * Whether the "tiếp tục" checkbox on this row can be ticked.
 *
 * Needs all three: a kind that can be continued, something already there to
 * continue from, and the field actually being written - continuing a field the
 * model isn't writing is a contradiction.
 */
export function canContinue(
  spec: AiFieldSpec,
  schema: ComponentSchema,
  value: unknown,
  column: Column,
): boolean {
  return (
    isContinuableKind(spec) && column === "fill" && !isFieldEmpty(schema, value)
  );
}

/** Whether the length picker on this row can be used. */
export function canPickSize(spec: AiFieldSpec, column: Column): boolean {
  return spec.kind === "content" && column === "fill";
}

/**
 * Where each field sits when the dialog opens.
 *
 * The general rule is "what's blank gets written, what's there is context":
 * right on a fresh entry (fill everything) and on a half-written one (keep
 * what's there).
 *
 * Content fields are the exception, and never default into the context column.
 * A written body is the single most expensive thing that could go into a
 * prompt, and it's rarely what makes the difference to a title or a meta
 * description - so it's offered, not assumed. Ticking it across is still one
 * click; spending the tokens is the part that shouldn't be automatic.
 */
export function initialSelection(args: {
  specs: AiFieldSpec[];
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
  /** when set, the only field being written - everything else is background */
  singleFieldKey?: string;
}): Record<string, Column> {
  const { specs, schema, state, singleFieldKey } = args;
  const out: Record<string, Column> = {};

  for (const spec of specs) {
    if (singleFieldKey) {
      out[spec.key] =
        spec.key === singleFieldKey
          ? "fill"
          : spec.kind === "content"
            ? "none"
            : "context";
      continue;
    }

    if (isFieldEmpty(schema[spec.key], state[spec.key])) {
      out[spec.key] = "fill";
      continue;
    }
    out[spec.key] = spec.kind === "content" ? "none" : "context";
  }

  return out;
}
