import { Box } from '@keystar/ui/layout';
import {
  SplitView,
  SplitPanePrimary,
  SplitPaneSecondary,
} from '@keystar/ui/split-view';
import { ReactNode, createContext, useContext } from 'react';

import { ReadonlyPropPath } from '../form/fields/document/DocumentEditor/component-blocks/utils';
import {
  AddToPathProvider,
  PathContextProvider,
  SlugFieldInfo,
  SlugFieldProvider,
} from '../form/fields/text/path-slug-context';
import {
  InnerFormValueContentFromPreviewProps,
  FormValueContentFromPreviewProps,
} from '../form/form-from-preview';
import {
  GenericPreviewProps,
  ObjectField,
  ComponentSchema,
  Collection,
  Singleton,
} from '..';
import { FormatInfo } from './path-utils';
import { ScrollView } from './shell/primitives';
import { PageContainer } from './shell/page';
import { useContentPanelQuery } from './shell/context';
import { isContentEditorField } from '../form/fields/content/is-content-field';

const emptyArray: ReadonlyPropPath = [];
const RESPONSIVE_PADDING = {
  mobile: 'medium',
  tablet: 'xlarge',
  desktop: 'xxlarge',
};

export function containerWidthForEntryLayout(
  config: Collection<any, any> | Singleton<any>
) {
  return config.entryLayout === 'content' ? 'none' : 'medium';
}

const EntryLayoutSplitPaneContext = createContext<'main' | 'side' | null>(null);
export function useEntryLayoutSplitPaneContext() {
  return useContext(EntryLayoutSplitPaneContext);
}

// the repo directory the current entry's files live in (e.g. `posts/my-post`),
// or `null` for singletons — used to scope the "this entry's images" tab in
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

function isPreviewPropsKind<Kind extends ComponentSchema['kind']>(
  props: GenericPreviewProps<ComponentSchema, unknown>,
  kind: Kind
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
  entryLayout: 'content' | 'form' | undefined;
  forceValidation: boolean | undefined;
  slugField: SlugFieldInfo | undefined;
}) {
  const isAboveMobile = useContentPanelQuery({ above: 'mobile' });

  // the field that fills the main content pane: an explicit `format.contentField`
  // (a separate-file `formKind: 'content'` field) if configured, otherwise the
  // entry's inline `fields.content` rich-text field, auto-detected so that
  // `entryLayout: 'content'` "just works" without extra config.
  let contentPanePath: readonly string[] | undefined =
    formatInfo.contentField?.path;
  if (!contentPanePath && entryLayout === 'content') {
    for (const [key, child] of Object.entries(props.fields)) {
      if (isContentEditorField(child.schema)) {
        contentPanePath = [key];
        break;
      }
    }
  }

  if (entryLayout === 'content' && contentPanePath && isAboveMobile) {
    let contentFieldProps: GenericPreviewProps<ComponentSchema, unknown> =
      props;
    for (const key of contentPanePath) {
      if (isPreviewPropsKind(contentFieldProps, 'object')) {
        contentFieldProps = contentFieldProps.fields[key];
        continue;
      }
      if (isPreviewPropsKind(contentFieldProps, 'conditional')) {
        if (key !== 'value') {
          throw new Error(
            'Conditional fields referenced in a contentField path must only reference the value field.'
          );
        }
        contentFieldProps = contentFieldProps.value;
        continue;
      }
      throw new Error(
        `Path specified in contentField does not point to a content field`
      );
    }
    return (
      <PathContextProvider value={emptyArray}>
        <SlugFieldProvider value={slugField}>
          <SplitView
            autoSaveId="keystatic-content-split-view"
            defaultSize={320}
            minSize={240}
            maxSize={480}
            flex
          >
            <SplitPaneSecondary>
              <EntryLayoutSplitPaneContext.Provider value="main">
                <ScrollView>
                  <AddToPathProvider part={contentPanePath as ReadonlyPropPath}>
                    <InnerFormValueContentFromPreviewProps
                      forceValidation={forceValidation}
                      {...contentFieldProps}
                    />
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
