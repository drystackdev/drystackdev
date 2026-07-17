import { FormFieldStoredValue, SlugFormField } from "../../api";
import { validateText } from "../text/validateText";
import { SlugFieldInput, slugify } from "#field-ui/slug";
import { Glob } from "../../..";
import { FieldDataError } from "../error";

function parseSlugFieldAsNormalField(value: FormFieldStoredValue) {
  if (value === undefined) {
    return { name: "", slug: "" };
  }
  if (typeof value !== "object") {
    throw new FieldDataError("Must be an object");
  }
  if (Object.keys(value).length !== 2) {
    throw new FieldDataError("Unexpected keys");
  }
  if (!("name" in value) || !("slug" in value)) {
    throw new FieldDataError("Missing name or slug");
  }
  if (typeof value.name !== "string") {
    throw new FieldDataError("name must be a string");
  }
  if (typeof value.slug !== "string") {
    throw new FieldDataError("slug must be a string");
  }
  return { name: value.name, slug: value.slug };
}

function parseAsSlugField(value: FormFieldStoredValue, slug: string) {
  if (value === undefined) {
    return { name: "", slug };
  }
  if (typeof value !== "string") {
    throw new FieldDataError("Must be a string");
  }
  return { name: value, slug };
}

export function slug(_args: {
  name: {
    label: string;
    defaultValue?: string;
    description?: string;
    validation?: {
      isRequired?: boolean;
      length?: {
        min?: number;
        max?: number;
      };
      pattern?: { regex: RegExp; message?: string };
    };
  };
  slug?: {
    label?: string;
    generate?: (name: string) => string;
    description?: string;
    validation?: {
      length?: {
        min?: number;
        max?: number;
      };
      pattern?: { regex: RegExp; message?: string };
    };
  };
}): SlugFormField<
  { name: string; slug: string },
  { name: string; slug: string },
  { name: string; slug: string },
  string
> & {
  // Exposed so non-UI callers (the AI apply step) derive the slug through the
  // exact same function the input uses while typing - a second
  // implementation would drift and produce different URLs for the same title.
  slugify(name: string): string;
} {
  const args = {
    ..._args,
    name: {
      ..._args.name,
      validation: {
        pattern: _args.name.validation?.pattern,
        length: {
          min: Math.max(
            (_args.name.validation?.isRequired ?? true) ? 1 : 0,
            _args.name.validation?.length?.min ?? 0,
          ),
          max: _args.name.validation?.length?.max,
        },
      },
    },
  };
  const naiveGenerateSlug: (name: string) => string =
    args.slug?.generate || slugify;
  let _defaultValue: { name: string; slug: string } | undefined;

  function defaultValue() {
    if (!_defaultValue) {
      _defaultValue = {
        name: args.name.defaultValue ?? "",
        slug: naiveGenerateSlug(args.name.defaultValue ?? ""),
      };
    }
    return _defaultValue;
  }

  function validate(
    value: { name: string; slug: string },
    {
      slugField,
    }: {
      slugField: { slugs: Set<string>; glob: Glob } | undefined;
    } = { slugField: undefined },
  ) {
    const nameMessage = validateText(
      value.name,
      args.name.validation?.length?.min ?? 0,
      args.name.validation?.length?.max ?? Infinity,
      args.name.label,
      undefined,
      args.name.validation?.pattern,
    );
    if (nameMessage !== undefined) {
      throw new FieldDataError(nameMessage);
    }
    const slugMessage = validateText(
      value.slug,
      args.slug?.validation?.length?.min ?? 1,
      args.slug?.validation?.length?.max ?? Infinity,
      args.slug?.label ?? "Slug",
      slugField ? slugField : { slugs: emptySet, glob: "*" },
      args.slug?.validation?.pattern,
    );
    if (slugMessage !== undefined) {
      throw new FieldDataError(slugMessage);
    }

    return value;
  }

  const emptySet = new Set<string>();
  return {
    kind: "form",
    formKind: "slug",
    label: args.name.label,
    slugify: naiveGenerateSlug,
    // only the human-readable `name` half is described to the AI - the `slug`
    // half is derived from it by `naiveGenerateSlug`, exactly as it is when a
    // person types the name in.
    aiMeta: {
      description: args.name.description,
      isRequired: (args.name.validation?.length?.min ?? 0) > 0,
    },
    Input(props) {
      return (
        <SlugFieldInput
          args={args}
          naiveGenerateSlug={naiveGenerateSlug}
          defaultValue={defaultValue()}
          {...props}
        />
      );
    },
    defaultValue,
    parse(value, args) {
      if (args?.slug !== undefined) {
        return parseAsSlugField(value, args.slug);
      }
      return parseSlugFieldAsNormalField(value);
    },

    validate,
    serialize(value) {
      return { value };
    },
    serializeWithSlug(value) {
      return { value: value.name, slug: value.slug };
    },
    reader: {
      parse(value) {
        const parsed = parseSlugFieldAsNormalField(value);
        return validate(parsed);
      },
      parseWithSlug(value, args) {
        return validate(parseAsSlugField(value, args.slug), {
          slugField: { glob: args.glob, slugs: emptySet },
        }).name;
      },
    },
  };
}
