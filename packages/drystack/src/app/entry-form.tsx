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
import { EntryRef, FormatInfo } from "./path-utils";
import { ScrollView } from "./shell/primitives";
import { PageContainer } from "./shell/page";
import { useContentPanelQuery } from "./shell/context";
import { isContentEditorField } from "../form/fields/content/is-content-field";
import { css } from "@keystar/ui/style";
import { AiLockOverlay } from "./ai/AiLockOverlay";

const emptyArray: ReadonlyPropPath = [];

// The content pane renders its field directly, bypassing the object field's
// per-field chrome (form/fields/object/ui.tsx) - so the AI lock has to be
// re-hung here, or the entry's main field would be the one field the feature
// can't reach. The AI button itself needs no such re-hanging: it lives in the
// content editor's own toolbar (markdoc/editor/Toolbar.tsx's
// ContentToolbarAiButton), which this field renders regardless of which pane
// it's in.
//
// The field wrapper is both the hover target for other fields' per-field
// buttons and the element edit-sync looks up by data-field, so it has to wrap
// the editor itself. That puts it in the middle of the pane's height chain:
// the editor sizes itself against its parent, so without at least 100% it
// collapses to the height of the text and stops filling the pane.
const contentPaneField = css({
  height: "100%",
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

// the EntryRef of the entry currently open in this editor - used by the
// content field's "Import content" button (markdoc/editor/content-ref.tsx) to
// exclude the entry being edited from its own picker (an entry can't import
// its own content field). `null` when there's no entry in scope.
const CurrentEntryRefContext = createContext<EntryRef | null>(null);
export const CurrentEntryRefProvider = CurrentEntryRefContext.Provider;
export function useCurrentEntryRefContext() {
  return useContext(CurrentEntryRefContext);
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
                        finds the focused field by data-field, and
                        useScrollToFieldParam finds it by data-field-path.
                        In this layout the field lives here, not in the pane
                        that renders the rest of the schema. */}
                    <div
                      data-field={contentPanePath[0]}
                      data-field-path={contentPanePath.join(".")}
                      className={contentPaneField}
                    >
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
                      omitFieldAtPath={contentPanePath}
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
