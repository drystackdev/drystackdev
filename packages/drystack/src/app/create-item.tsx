import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as s from 'superstruct';

import { Button } from '@keystar/ui/button';
import { DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { historyIcon } from '@keystar/ui/icon/icons/historyIcon';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { ProgressCircle } from '@keystar/ui/progress';
import { toastQueue } from '@keystar/ui/toast';

import { Config } from '../config';
import { ComponentSchema, GenericPreviewProps, ObjectField } from '../form/api';
import { getInitialPropsValue } from '../form/initial-values';
import { clientSideValidateProp } from '../form/errors';
import { useEventCallback } from '../form/fields/use-event-callback';

import { CreateBranchDuringUpdateDialog } from './ItemPage';
import l10nMessages from './l10n';
import { useBaseCommit } from './shell/data';
import { PageRoot, PageHeader, PageBody } from './shell/page';
import { ForkRepoDialog } from './fork-repo';
import {
  EntryDirectoryProvider,
  FormForEntry,
  containerWidthForEntryLayout,
} from './entry-form';
import { notFound } from './not-found';
import { delDraft, getDraft, setDraft } from './persistence';
import { useRouter } from './router';
import { HeaderBreadcrumbs } from './shell/HeaderBreadcrumbs';
import { useConfig } from './shell/context';
import { useSlugFieldInfo } from './slugs';
import { useData } from './useData';
import { serializeEntryToFiles, useUpsertItem } from './updating';
import { parseEntry, useItemData } from './useItemData';
import { useHasChanged } from './useHasChanged';
import {
  getCollectionFormat,
  getCollectionItemPath,
  getSlugFromState,
  isGitHubConfig,
  useShowRestoredDraftMessage,
} from './utils';
import { useCollection, usePreviewProps } from './preview-props';
import { useDuplicateSlug } from './duplicate-slug';
import { AiLockProvider } from './ai/lock-context';
import { MagicWriteButton, useAiEntryDescription } from './ai/MagicWriteButton';
import { useMagicWrite } from './ai/useMagicWrite';
import { setValueToPreviewProps } from '../form/get-value';
import { copyEntryToClipboard, getPastedEntry } from './entry-clipboard';
import { clipboardCopyIcon } from '@keystar/ui/icon/icons/clipboardCopyIcon';
import { clipboardPasteIcon } from '@keystar/ui/icon/icons/clipboardPasteIcon';
import { ActionGroup, Item } from '@keystar/ui/action-group';
import { Text } from '@keystar/ui/typography';
import { breakpointQueries, useMediaQuery } from '@keystar/ui/style';

function CreateItemWrapper(props: {
  collection: string;
  config: Config;
  basePath: string;
}) {
  const router = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const duplicateSlug = useMemo(() => {
    const url = new URL(router.href, 'http://localhost');
    return url.searchParams.get('duplicate');
  }, [router.href]);

  const collectionConfig = props.config.collections?.[props.collection];
  if (!collectionConfig) notFound();
  const format = useMemo(
    () => getCollectionFormat(props.config, props.collection),
    [props.config, props.collection]
  );

  const draftData = useData(
    useCallback(async () => {
      const raw = await getDraft([
        'collection-create',
        props.collection,
        ...(duplicateSlug ? ([duplicateSlug] as const) : ([] as const)),
      ]);
      if (!raw) throw new Error('No draft found');
      const stored = storedValSchema.create(raw);
      const parsed = parseEntry(
        {
          dirpath: getCollectionItemPath(
            props.config,
            props.collection,
            stored.slug
          ),
          format,
          schema: collectionConfig.schema,
          slug: { field: collectionConfig.slugField, slug: stored.slug },
        },
        stored.files
      );
      return { state: parsed.initialState, savedAt: stored.savedAt };
    }, [
      collectionConfig,
      duplicateSlug,
      format,
      props.collection,
      props.config,
    ])
  );

  const slug = useMemo(() => {
    if (duplicateSlug) {
      return { field: collectionConfig.slugField, slug: duplicateSlug };
    }
    if (collectionConfig.template) {
      return { field: collectionConfig.slugField, slug: '' };
    }
  }, [duplicateSlug, collectionConfig]);

  const isFromTemplate = !!duplicateSlug || !!collectionConfig.template;

  const itemData = useItemData({
    config: props.config,
    dirpath:
      collectionConfig.template && !duplicateSlug
        ? collectionConfig.template
        : getCollectionItemPath(
            props.config,
            props.collection,
            duplicateSlug ?? ''
          ),
    schema: collectionConfig.schema,
    format,
    slug,
  });

  const duplicateInitalState =
    isFromTemplate &&
    itemData.kind === 'loaded' &&
    itemData.data !== 'not-found'
      ? itemData.data.initialState
      : undefined;

  const duplicateInitalStateWithUpdatedSlug = useDuplicateSlug(
    duplicateInitalState,
    collectionConfig
  );

  if (isFromTemplate && itemData.kind === 'error') {
    return (
      <PageBody>
        <Notice tone="critical">{itemData.error.message}</Notice>
      </PageBody>
    );
  }
  if (
    (isFromTemplate && itemData.kind === 'loading') ||
    draftData.kind === 'loading'
  ) {
    return (
      <Flex alignItems="center" justifyContent="center" minHeight="scale.3000">
        <ProgressCircle
          aria-label={stringFormatter.format('loadingItem')}
          isIndeterminate
          size="large"
        />
      </Flex>
    );
  }
  if (
    isFromTemplate &&
    itemData.kind === 'loaded' &&
    itemData.data === 'not-found'
  ) {
    return (
      <PageBody>
        <Notice tone="caution">
          {stringFormatter.format('entryNotFound')}
        </Notice>
      </PageBody>
    );
  }

  return (
    <CreateItemLocal
      collection={props.collection}
      config={props.config}
      basePath={props.basePath}
      draft={draftData.kind === 'loaded' ? draftData.data : undefined}
      duplicateSlug={duplicateSlug}
      initialState={duplicateInitalStateWithUpdatedSlug}
    />
  );
}

const storedValSchema = s.type({
  version: s.literal(1),
  savedAt: s.date(),
  slug: s.string(),
  files: s.map(s.string(), s.instance(Uint8Array)),
});

function CreateItemLocal(props: {
  collection: string;
  config: Config;
  basePath: string;
  duplicateSlug: string | null;
  draft: { state: Record<string, unknown>; savedAt: Date } | undefined;
  initialState: Record<string, unknown> | undefined;
}) {
  const { collectionConfig, schema } = useCollection(props.collection);
  const initialState = useMemo(() => {
    return props.initialState ?? getInitialPropsValue(schema);
  }, [props.initialState, schema]);
  const [state, setState] = useState(props.draft?.state ?? initialState);

  const previewProps = usePreviewProps(schema, setState, state);

  const magicWriteEntry = useMemo(
    () => ({ kind: 'collection' as const, key: props.collection }),
    [props.collection]
  );
  const magicWrite = useMagicWrite({
    entry: magicWriteEntry,
    schema: collectionConfig.schema,
    // A React setState already takes an updater function, which is exactly the
    // shape the hook writes through.
    onStateChange: setState,
  });

  useShowRestoredDraftMessage(props.draft, state, undefined);

  const slug = getSlugFromState(collectionConfig, state);

  const formatInfo = getCollectionFormat(props.config, props.collection);

  const basePath = getCollectionItemPath(props.config, props.collection, slug);
  const [createResult, _createItem, resetCreateItemState] = useUpsertItem({
    state,
    basePath,
    initialFiles: undefined,
    config: props.config,
    schema: collectionConfig.schema,
    format: formatInfo,
    currentLocalTreeKey: undefined,
    slug: { field: collectionConfig.slugField, value: slug },
  });
  const createItem = useEventCallback(_createItem);

  const hasChanged = useHasChanged({
    initialState,
    schema,
    state,
    slugField: collectionConfig.slugField,
  });
  const hasCreated =
    createResult.kind === 'updated' || createResult.kind === 'loading';

  useEffect(() => {
    const key = [
      'collection-create',
      props.collection,
      ...(props.duplicateSlug
        ? ([props.duplicateSlug] as const)
        : ([] as const)),
    ] as const;
    if (hasChanged && !hasCreated) {
      const serialized = serializeEntryToFiles({
        basePath,
        format: formatInfo,
        schema: collectionConfig.schema,
        slug: { field: collectionConfig.slugField, value: slug },
        state,
      });
      const files = new Map<string, Uint8Array<ArrayBuffer>>(
        serialized.map(x => [x.path, x.contents as Uint8Array<ArrayBuffer>])
      );
      const data: s.Infer<typeof storedValSchema> = {
        slug,
        files,
        savedAt: new Date(),
        version: 1,
      };
      setDraft(key, data);
    } else {
      delDraft(key);
    }
  }, [
    collectionConfig,
    slug,
    state,
    hasChanged,
    props.duplicateSlug,
    props.collection,
    basePath,
    formatInfo,
    hasCreated,
  ]);
  return (
    <CreateItemInner
      basePath={props.basePath}
      entryDirectory={basePath}
      collection={props.collection}
      createResult={createResult}
      createItem={createItem}
      resetCreateItemState={resetCreateItemState}
      state={state}
      slug={slug}
      previewProps={previewProps}
      magicWrite={magicWrite}
      onReset={() => {
        setState(initialState);
      }}
    />
  );
}

function CreateItemInner(props: {
  basePath: string;
  entryDirectory: string;
  collection: string;
  createResult: ReturnType<typeof useUpsertItem>[0];
  createItem: ReturnType<typeof useUpsertItem>[1];
  resetCreateItemState: ReturnType<typeof useUpsertItem>[2];
  state: Record<string, unknown>;
  slug: string;
  previewProps: GenericPreviewProps<
    ObjectField<Record<string, ComponentSchema>>,
    undefined
  >;
  onReset: () => void;
  magicWrite: ReturnType<typeof useMagicWrite>;
}) {
  const { onReset } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const router = useRouter();
  const config = useConfig();

  const { collectionConfig, schema } = useCollection(props.collection);
  const aiEntryDescription = useAiEntryDescription(config, "collection", props.collection);

  const [forceValidation, setForceValidation] = useState(false);
  const formatInfo = getCollectionFormat(config, props.collection);

  const baseCommit = useBaseCommit();

  let collectionPath = `${props.basePath}/collection/${encodeURIComponent(
    props.collection
  )}`;

  const { createResult } = props;

  const currentSlug =
    createResult.kind === 'updated' || createResult.kind === 'loading'
      ? props.slug
      : undefined;
  const slugInfo = useSlugFieldInfo(props.collection, currentSlug);

  const onCreate = async () => {
    if (createResult.kind === 'loading') return;
    if (!clientSideValidateProp(schema, props.state, slugInfo)) {
      setForceValidation(true);
      return;
    }
    if (await props.createItem()) {
      const slug = getSlugFromState(collectionConfig, props.state);
      router.push(`${collectionPath}/item/${encodeURIComponent(slug)}`);
      toastQueue.positive(stringFormatter.format('entryCreatedToast'), {
        timeout: 5000,
      });
    }
  };

  const onCopy = () => {
    copyEntryToClipboard(props.state, formatInfo, collectionConfig.schema, {
      field: collectionConfig.slugField,
      value: getSlugFromState(collectionConfig, props.state),
    });
  };

  const onPaste = async () => {
    const entry = await getPastedEntry(
      formatInfo,
      collectionConfig.schema,
      {
        field: collectionConfig.slugField,
        slug: getSlugFromState(collectionConfig, props.state),
      },
      stringFormatter,
    );
    if (entry) {
      setValueToPreviewProps(entry, props.previewProps);
      toastQueue.positive(stringFormatter.format('entryPastedToast'), {
        shouldCloseOnAction: true,
        actionLabel: stringFormatter.format('undo'),
        onAction: () => {
          setValueToPreviewProps(props.state, props.previewProps);
        },
      });
    }
  };

  // note we're still "loading" when it's already been created
  // since we're waiting to go to the item page
  const isLoading =
    createResult.kind === 'loading' || createResult.kind === 'updated';

  const formID = 'item-create-form';
  const breadcrumbItems = useMemo(
    () => [
      {
        key: 'collection',
        label: collectionConfig.label,
        href: collectionPath,
      },
      { key: 'current', label: stringFormatter.format('add') },
    ],
    [collectionConfig.label, stringFormatter, collectionPath]
  );

  const isBelowDesktop = useMediaQuery(breakpointQueries.below.desktop);

  return (
    <AiLockProvider
      lockedKeys={props.magicWrite.streamingKeys}
      fieldMagicWrite={
        aiEntryDescription
          ? {
              entryLabel: collectionConfig.label,
              schema: collectionConfig.schema,
              state: props.state,
              magicWrite: props.magicWrite,
            }
          : null
      }
    >
      <PageRoot containerWidth={containerWidthForEntryLayout(collectionConfig)}>
        <PageHeader>
          <HeaderBreadcrumbs items={breadcrumbItems} />
          {isLoading && (
            <ProgressCircle
              aria-label={stringFormatter.format('creatingEntry')}
              isIndeterminate
              size="small"
            />
          )}
          <ActionGroup
            buttonLabelBehavior="hide"
            overflowMode="collapse"
            prominence="low"
            density="compact"
            maxWidth={isBelowDesktop ? 'element.regular' : undefined} // force switch to action menu on small devices
            items={menuActions}
            onAction={key => {
              switch (key) {
                case 'reset':
                  onReset();
                  setForceValidation(false);
                  break;
                case 'copy':
                  onCopy();
                  break;
                case 'paste':
                  onPaste();
                  break;
              }
            }}
          >
            {item => (
              <Item key={item.key} textValue={item.label}>
                <Icon src={item.icon} />
                <Text>{item.label}</Text>
              </Item>
            )}
          </ActionGroup>
          {aiEntryDescription && (
            <MagicWriteButton
              entryLabel={collectionConfig.label}
              schema={collectionConfig.schema}
              state={props.state}
              magicWrite={props.magicWrite}
            />
          )}
          <Button
            isPending={isLoading}
            prominence="high"
            type="submit"
            form={formID}
            marginStart="auto"
          >
            {stringFormatter.format('create')}
          </Button>
        </PageHeader>
        <Flex
          id={formID}
          elementType="form"
          onSubmit={event => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            onCreate();
          }}
          direction="column"
          gap="xxlarge"
          height="100%"
          minHeight={0}
          minWidth={0}
        >
          {createResult.kind === 'error' && (
            <Notice tone="critical">{createResult.error.message}</Notice>
          )}
          <EntryDirectoryProvider value={props.entryDirectory}>
            <FormForEntry
              previewProps={props.previewProps}
              forceValidation={forceValidation}
              entryLayout={collectionConfig.entryLayout}
              formatInfo={formatInfo}
              slugField={slugInfo}
            />
          </EntryDirectoryProvider>
        </Flex>
      </PageRoot>

      <DialogContainer
        // ideally this would be a popover on desktop but using a DialogTrigger
        // wouldn't work since this doesn't open on click but after doing a
        // network request and it failing and manually wiring about a popover
        // and modal would be a pain
        onDismiss={props.resetCreateItemState}
      >
        {createResult.kind === 'needs-new-branch' && (
          <CreateBranchDuringUpdateDialog
            branchOid={baseCommit}
            onCreate={async newBranch => {
              router.push(
                `${router.basePath}/branch/${encodeURIComponent(
                  newBranch
                )}/collection/${encodeURIComponent(props.collection)}/create`
              );
              if (
                await props.createItem({ branch: newBranch, sha: baseCommit })
              ) {
                const slug = getSlugFromState(collectionConfig, props.state);

                router.push(
                  `${router.basePath}/branch/${encodeURIComponent(
                    newBranch
                  )}/collection/${encodeURIComponent(
                    props.collection
                  )}/item/${encodeURIComponent(slug)}`
                );
              }
            }}
            reason={createResult.reason}
            onDismiss={props.resetCreateItemState}
          />
        )}
      </DialogContainer>
      <DialogContainer
        // ideally this would be a popover on desktop but using a DialogTrigger
        // wouldn't work since this doesn't open on click but after doing a
        // network request and it failing and manually wiring about a popover
        // and modal would be a pain
        onDismiss={props.resetCreateItemState}
      >
        {createResult.kind === 'needs-fork' && isGitHubConfig(config) && (
          <ForkRepoDialog
            onCreate={async () => {
              if (await props.createItem()) {
                const slug = getSlugFromState(collectionConfig, props.state);
                router.push(
                  `${collectionPath}/item/${encodeURIComponent(slug)}`
                );
              }
            }}
            onDismiss={props.resetCreateItemState}
            config={config}
          />
        )}
      </DialogContainer>
    </AiLockProvider>
  );
}

const menuActions = [
  {
    key: 'reset',
    label: 'Reset',
    icon: historyIcon,
  },
  {
    key: 'copy',
    label: 'Copy entry',
    icon: clipboardCopyIcon,
  },
  {
    key: 'paste',
    label: 'Paste entry',
    icon: clipboardPasteIcon,
  },
];

export { CreateItemWrapper as CreateItem };
