import { Box } from "@keystar/ui/layout";
import {
  SplitView,
  SplitPanePrimary,
  SplitPaneSecondary,
} from "@keystar/ui/split-view";
import { ReactNode, createContext, useContext } from "react";

import { ReadonlyPropPath } from "../form/fields/prop-path";
import {
  AddToPathProvider,
  PathContextProvider,
  SlugFieldInfo,
  SlugFieldProvider,
} from "../form/fields/text/path-slug-context";
import {
  InnerFormValueContentFromPreviewProps,
  FormValueContentFromPreviewProps,
} from "../form/form-from-preview";
import {
  GenericPreviewProps,
  ObjectField,
  ComponentSchema,
  Collection,
  Singleton,
} from "..";
import { FormatInfo } from "./path-utils";
import { ScrollView } from "./shell/primitives";
import { PageContainer } from "./shell/page";
import { useContentPanelQuery } from "./shell/context";
import { isContentEditorField } from "../form/fields/content/is-content-field";
import { css, tokenSchema } from "@keystar/ui/style";
import { AiLockOverlay } from "./ai/AiLockOverlay";
import { FieldMagicWriteButton } from "./ai/FieldMagicWriteButton";

const emptyArray: ReadonlyPropPath = [];

// The content pane renders its field directly, bypassing the object field's
// per-field chrome (form/fields/object/ui.tsx) - so the Magic write button and
// the AI lock have to be re-hung here, or the entry's main field would be the
// one field the feature can't reach.
//
// Sticky rather than absolute: the pane scrolls, and a button that scrolls out
// of reach on a long post is barely better than no button. Zero height keeps it
// out of the flow, so hanging it here can't push the editor down.
//
// It lands in the editor toolbar's empty right end, which means it has to beat
// the toolbar's own `zIndex: 2` (markdoc/editor/Toolbar.tsx). At an equal
// z-index the toolbar wins on DOM order and paints its 90%-opaque background
// over the button — which reads as a washed-out icon, but also silently makes
// the button unclickable.
const contentPaneAiFloat = css({
  position: "sticky",
  insetBlockStart: tokenSchema.size.space.regular,
  zIndex: 3,
  height: 0,
  display: "flex",
  justifyContent: "flex-end",
  paddingInlineEnd: tokenSchema.size.space.regular,
  // The zero-height strip spans the pane; only the button itself should
  // swallow clicks meant for the text under it.
  pointerEvents: "none",
  "& > *": { pointerEvents: "auto" },
  // Hidden until the field is hovered or focused, like every other field's
  // button (form/fields/object/ui.tsx) — the editor's toolbar is busy enough
  // without a control that belongs to the field, not the toolbar.
  opacity: 0,
  transition: "opacity 130ms",
  // Keyboard users still reach it: focus-within below reveals it.
  "&:focus-within": { opacity: 1 },
});

// The field wrapper is both the hover target for the button above and the
// element edit-sync looks up by data-field, so it has to wrap the editor
// itself. That puts it in the middle of the pane's height chain: the editor
// sizes itself against its parent, so without an explicit 100% it collapses to
// the height of the text and stops filling the pane.
const contentPaneField = css({
  height: "100%",
  "&:hover [data-drystack-field-ai], &:focus-within [data-drystack-field-ai]": {
    opacity: 1,
  },
});
const RESPONSIVE_PADDING = {
  mobile: "medium",
  tablet: "xlarge",
  desktop: "xxlarge",
};

export function containerWidthForEntryLayout(
  config: Collection<any, any> | Singleton<any>,
) {
  return config.entryLayout === "content" ? "none" : "medium";
}

const EntryLayoutSplitPaneContext = createContext<"main" | "side" | null>(null);
export function useEntryLayoutSplitPaneContext() {
  return useContext(EntryLayoutSplitPaneContext);
}

// the repo directory the current entry's files live in (e.g. `posts/my-post`),
// or `null` for singletons - used to scope the "this entry's images" tab in
// the media library dialog. See MediaScopeProvider in the markdoc editor.
const EntryDirectoryContext = createContext<string | null>(null);
export const EntryDirectoryProvider = EntryDirectoryContext.Provider;
export function useEntryDirectoryContext() {
  return useContext(EntryDirectoryContext);
}

export function ResetEntryLayoutContext(props: { children: ReactNode }) {
  return (
    <EntryLayoutSplitPaneContext.Provider value={null}>
      {props.children}
    </EntryLayoutSplitPaneContext.Provider>
  );
}

function isPreviewPropsKind<Kind extends ComponentSchema["kind"]>(
  props: GenericPreviewProps<ComponentSchema, unknown>,
  kind: Kind,
): props is GenericPreviewProps<
  Extract<ComponentSchema, { kind: Kind }>,
  unknown
> {
  return props.schema.kind === kind;
}

export function FormForEntry({
  formatInfo,
  forceValidation,
  slugField,
  entryLayout,
  previewProps: props,
}: {
  previewProps: GenericPreviewProps<
    ObjectField<Record<string, ComponentSchema>>,
    unknown
  >;
  formatInfo: FormatInfo;
  entryLayout: "content" | "form" | undefined;
  forceValidation: boolean | undefined;
  slugField: SlugFieldInfo | undefined;
}) {
  const isAboveMobile = useContentPanelQuery({ above: "mobile" });

  // the field that fills the main content pane: an explicit `format.contentField`
  // (a separate-file `formKind: 'content'` field) if configured, otherwise the
  // entry's inline `fields.content` rich-text field, auto-detected so that
  // `entryLayout: 'content'` "just works" without extra config.
  let contentPanePath: readonly string[] | undefined =
    formatInfo.contentField?.path;
  if (!contentPanePath && entryLayout === "content") {
    for (const [key, child] of Object.entries(props.fields)) {
      if (isContentEditorField(child.schema)) {
        contentPanePath = [key];
      }
    }
  }

  if (entryLayout === "content" && contentPanePath && isAboveMobile) {
    let contentFieldProps: GenericPreviewProps<ComponentSchema, unknown> =
      props;
    for (const key of contentPanePath) {
      if (isPreviewPropsKind(contentFieldProps, "object")) {
        contentFieldProps = contentFieldProps.fields[key];
        continue;
      }
      if (isPreviewPropsKind(contentFieldProps, "conditional")) {
        if (key !== "value") {
          throw new Error(
            "Conditional fields referenced in a contentField path must only reference the value field.",
          );
        }
        contentFieldProps = contentFieldProps.value;
        continue;
      }
      throw new Error(
        `Path specified in contentField does not point to a content field`,
      );
    }
    return (
      <PathContextProvider value={emptyArray}>
        <SlugFieldProvider value={slugField}>
          <SplitView
            autoSaveId="drystack-content-split-view"
            defaultSize={320}
            minSize={240}
            maxSize={480}
            flex
          >
            <SplitPaneSecondary>
              <EntryLayoutSplitPaneContext.Provider value="main">
                <ScrollView>
                  <AddToPathProvider part={contentPanePath as ReadonlyPropPath}>
                    {/* Same contract as object/ui.tsx's wrapper: edit-sync
                        finds the focused field by data-field. In this layout
                        the field lives here, not in the pane that renders the
                        rest of the schema. */}
                    <div
                      data-field={contentPanePath[0]}
                      className={contentPaneField}
                    >
                      <div className={contentPaneAiFloat} data-drystack-field-ai="">
                        <div>
                          <FieldMagicWriteButton />
                        </div>
                      </div>
                      <AiLockOverlay>
                        <InnerFormValueContentFromPreviewProps
                          forceValidation={forceValidation}
                          {...contentFieldProps}
                        />
                      </AiLockOverlay>
                    </div>
                  </AddToPathProvider>
                </ScrollView>
              </EntryLayoutSplitPaneContext.Provider>
            </SplitPaneSecondary>
            <SplitPanePrimary>
              <EntryLayoutSplitPaneContext.Provider value="side">
                <ScrollView>
                  <Box padding={RESPONSIVE_PADDING}>
                    <InnerFormValueContentFromPreviewProps
                      forceValidation={forceValidation}
                      omitFieldAtPath={contentPanePath as ReadonlyPropPath}
                      {...props}
                    />
                  </Box>
                </ScrollView>
              </EntryLayoutSplitPaneContext.Provider>
            </SplitPanePrimary>
          </SplitView>
        </SlugFieldProvider>
      </PathContextProvider>
    );
  }

  return (
    <ScrollView>
      <PageContainer paddingY={RESPONSIVE_PADDING}>
        <FormValueContentFromPreviewProps
          // autoFocus
          forceValidation={forceValidation}
          slugField={slugField}
          {...props}
        />
      </PageContainer>
    </ScrollView>
  );
}
