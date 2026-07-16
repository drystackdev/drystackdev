import { useRouter } from './router';
import {
  FormEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Badge } from '@keystar/ui/badge';
import { Button } from '@keystar/ui/button';
import { DialogContainer } from '@keystar/ui/dialog';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { ProgressCircle } from '@keystar/ui/progress';
import { Heading, Text } from '@keystar/ui/typography';

import { Config } from '../config';
import { clientSideValidateProp } from '../form/errors';
import { getInitialPropsValue } from '../form/initial-values';
import { useEventCallback } from '../form/fields/use-event-callback';
import {
  getDataFileExtension,
  getPathPrefix,
  getRepoUrl,
  getSingletonFormat,
  getSingletonPath,
  isGitHubConfig,
  useShowRestoredDraftMessage,
} from './utils';

import { CreateBranchDuringUpdateDialog } from './ItemPage';
import { PageBody, PageHeader, PageRoot } from './shell/page';
import { useBaseCommit, useCurrentBranch, useRepoInfo } from './shell/data';
import { useHasChanged } from './useHasChanged';
import {
  ChangePreviewDialog,
  type FieldChange,
} from './change-preview/ChangePreviewDialog';
import { computeFieldChanges } from './change-preview/computeFieldChanges';
import { AdminImageThumb } from './change-preview/AdminImageThumb';
import { parseEntry, useItemData } from './useItemData';
import { serializeEntryToFiles, useUpsertItem } from './updating';
import { Icon } from '@keystar/ui/icon';
import { ForkRepoDialog } from './fork-repo';
import {
  EntryDirectoryProvider,
  FormForEntry,
  containerWidthForEntryLayout,
} from './entry-form';
import { notFound } from './not-found';
import { delDraft, getDraft, setDraft } from './persistence';
import {
  editKey,
  getAllEdits,
  getPendingBlobsUnder,
  getSyncableFieldKind,
  isAssetKind,
  parseEditKey,
  publishDelete,
  publishEdit,
  spliceValueEdit,
  stashContentBlobs,
  subscribeEdits,
  type StashedBlobs,
  type SyncableFieldKind,
} from './edit-sync';
import * as s from 'superstruct';
import { useData } from './useData';
import { ActionGroup, Item } from '@keystar/ui/action-group';
import { useMediaQuery, breakpointQueries } from '@keystar/ui/style';
import { githubIcon } from '@keystar/ui/icon/icons/githubIcon';
import { externalLinkIcon } from '@keystar/ui/icon/icons/externalLinkIcon';
import { historyIcon } from '@keystar/ui/icon/icons/historyIcon';
import { usePreviewProps, useSingleton } from './preview-props';
import { ComponentSchema, GenericPreviewProps } from '..';
import { copyEntryToClipboard, getPastedEntry } from './entry-clipboard';
import { clipboardPasteIcon } from '@keystar/ui/icon/icons/clipboardPasteIcon';
import { clipboardCopyIcon } from '@keystar/ui/icon/icons/clipboardCopyIcon';
import { setValueToPreviewProps } from '../form/get-value';
import { toastQueue } from '@keystar/ui/toast';

type SingletonPageProps = {
  singleton: string;
  config: Config;
  initialState: Record<string, unknown> | null;
  initialFiles: string[];
  localTreeKey: string | undefined;
};

function SingletonPageInner(
  props: SingletonPageProps & {
    updateResult: ReturnType<typeof useUpsertItem>[0];
    onUpdate: ReturnType<typeof useUpsertItem>[1];
    onResetUpdateItem: ReturnType<typeof useUpsertItem>[2];
    hasChanged: boolean;
    state: Record<string, unknown>;
    onReset: () => void;
    previewProps: GenericPreviewProps<ComponentSchema, undefined>;
    changes: FieldChange[];
    onRevertField: (key: string) => void;
  }
) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const isBelowDesktop = useMediaQuery(breakpointQueries.below.desktop);
  const repoInfo = useRepoInfo();
  const currentBranch = useCurrentBranch();
  const [forceValidation, setForceValidation] = useState(false);

  const { schema, singletonConfig } = useSingleton(props.singleton);

  const router = useRouter();

  const previewHref = useMemo(() => {
    if (!singletonConfig.previewUrl) return undefined;
    return singletonConfig.previewUrl.replace('{branch}', currentBranch);
  }, [currentBranch, singletonConfig.previewUrl]);
  const isGitHub = isGitHubConfig(props.config);
  const formatInfo = getSingletonFormat(props.config, props.singleton);
  const singletonExists = !!props.initialState;
  const singletonPath = getSingletonPath(props.config, props.singleton);

  const viewHref =
    isGitHub && singletonExists && repoInfo
      ? `${getRepoUrl(repoInfo)}${
          formatInfo.dataLocation === 'index'
            ? `/tree/${currentBranch}/${
                getPathPrefix(props.config.storage) ?? ''
              }${singletonPath}`
            : `/blob/${
                getPathPrefix(props.config.storage) ?? ''
              }${currentBranch}/${singletonPath}${getDataFileExtension(
                formatInfo
              )}`
        }`
      : undefined;

  const menuActions = useMemo(() => {
    const actions: {
      key: string;
      label: string;
      icon: ReactElement;
      href?: string;
      target?: string;
      rel?: string;
    }[] = [
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
    if (previewHref) {
      actions.push({
        key: 'preview',
        label: 'Preview',
        icon: externalLinkIcon,
        href: previewHref,
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    }
    if (viewHref) {
      actions.push({
        key: 'view',
        label: 'View on GitHub',
        icon: githubIcon,
        href: viewHref,
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    }
    return actions;
  }, [previewHref, viewHref]);

  const formID = 'singleton-form';

  const baseCommit = useBaseCommit();

  // build tracking now lives on the Deploy button (deploy/DeployButton.tsx):
  // saves commit to the editor's brand branch, which never triggers a
  // Cloudflare build on its own — only merging a brand into the default
  // branch does. See plan/brand.md §11.

  const isCreating = props.initialState === null;

  const onCreate = async () => {
    if (props.updateResult.kind === 'loading' || !props.hasChanged) return;
    if (!clientSideValidateProp(schema, props.state, undefined)) {
      setForceValidation(true);
      return;
    }
    await props.onUpdate();
  };

  const onCopy = () => {
    copyEntryToClipboard(
      props.state,
      formatInfo,
      singletonConfig.schema,
      undefined
    );
  };

  const onPaste = async () => {
    const entry = await getPastedEntry(
      formatInfo,
      singletonConfig.schema,
      undefined
    );
    if (entry) {
      setValueToPreviewProps(entry, props.previewProps);
      toastQueue.positive('Entry pasted', {
        shouldCloseOnAction: true,
        actionLabel: 'Undo',
        onAction: () => {
          setValueToPreviewProps(props.state, props.previewProps);
        },
      });
    }
  };

  return (
    <PageRoot containerWidth={containerWidthForEntryLayout(singletonConfig)}>
      <PageHeader>
        <Flex flex alignItems="center" gap="regular">
          <Heading elementType="h1" id="page-title" size="small">
            {singletonConfig.label}
          </Heading>
          {props.updateResult.kind === 'loading' ? (
            <ProgressCircle
              aria-label={`Updating ${singletonConfig.label}`}
              isIndeterminate
              size="small"
              alignSelf="center"
            />
          ) : (
            props.hasChanged && (
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                aria-label="Review changes"
                style={{ all: 'unset', display: 'inline-flex', cursor: 'pointer' }}
              >
                <Badge tone="pending">Unsaved</Badge>
              </button>
            )
          )}
        </Flex>
        <ActionGroup
          buttonLabelBehavior="hide"
          overflowMode="collapse"
          prominence="low"
          density="compact"
          maxWidth={isBelowDesktop ? 'element.regular' : undefined} // force switch to action menu on small devices
          items={menuActions}
          disabledKeys={props.hasChanged ? [] : ['reset']}
          onAction={key => {
            switch (key) {
              case 'reset':
                props.onReset();
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
            <Item
              key={item.key}
              textValue={item.label}
              href={item.href}
              target={item.target}
              rel={item.rel}
            >
              <Icon src={item.icon} />
              <Text>{item.label}</Text>
            </Item>
          )}
        </ActionGroup>
        <Button
          form={formID}
          isPending={props.updateResult.kind === 'loading'}
          prominence="high"
          type="submit"
        >
          {isCreating ? 'Create' : 'Save'}
        </Button>
      </PageHeader>
      <Flex
        elementType="form"
        id={formID}
        onSubmit={(event: FormEvent) => {
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
        {props.updateResult.kind === 'error' && (
          <Notice tone="critical">{props.updateResult.error.message}</Notice>
        )}
        <EntryDirectoryProvider value={singletonPath}>
          <FormForEntry
            previewProps={props.previewProps as any}
            forceValidation={forceValidation}
            entryLayout={singletonConfig.entryLayout}
            formatInfo={formatInfo}
            slugField={undefined}
          />
        </EntryDirectoryProvider>
        <DialogContainer
          // ideally this would be a popover on desktop but using a DialogTrigger wouldn't work since
          // this doesn't open on click but after doing a network request and it failing and manually wiring about a popover and modal would be a pain
          onDismiss={props.onResetUpdateItem}
        >
          {props.updateResult.kind === 'needs-new-branch' && (
            <CreateBranchDuringUpdateDialog
              branchOid={baseCommit}
              onCreate={async newBranch => {
                router.push(
                  `${router.basePath}/branch/${encodeURIComponent(
                    newBranch
                  )}/singleton/${encodeURIComponent(props.singleton)}`
                );
                props.onUpdate({ branch: newBranch, sha: baseCommit });
              }}
              reason={props.updateResult.reason}
              onDismiss={props.onResetUpdateItem}
            />
          )}
        </DialogContainer>
        <DialogContainer
          // ideally this would be a popover on desktop but using a DialogTrigger
          // wouldn't work since this doesn't open on click but after doing a
          // network request and it failing and manually wiring about a popover
          // and modal would be a pain
          onDismiss={props.onResetUpdateItem}
        >
          {props.updateResult.kind === 'needs-fork' &&
            isGitHubConfig(props.config) && (
              <ForkRepoDialog
                onCreate={async () => {
                  props.onUpdate();
                }}
                onDismiss={props.onResetUpdateItem}
                config={props.config}
              />
            )}
        </DialogContainer>
        <DialogContainer onDismiss={() => setReviewOpen(false)}>
          {reviewOpen && (
            <ChangePreviewDialog
              changes={props.changes}
              onDelete={props.onRevertField}
              renderImage={(path: string) => <AdminImageThumb path={path} />}
            />
          )}
        </DialogContainer>
      </Flex>
    </PageRoot>
  );
}

// A field value as it lives in the admin form's own state — wider than
// `PendingEdit`'s bus-string, since a fields.array/fields.object value here
// is the real array/object, not its JSON-encoded bus form. fields.content is
// the exception and isn't covered: its form value is the editor's own state
// object, which never passes through fromBusValue (see contentFromBusValue).
type FieldValue = string | string[] | Record<string, unknown> | null;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// The narrow slice of a fields.content schema this file drives. Typed
// structurally — mirroring the visual editor's InlineContentEditors.tsx — so
// the admin page doesn't pull the field's own module graph in. The state
// itself stays opaque: this module only round-trips it through these two.
type ContentFieldSchema = {
  parse(
    value: unknown,
    extra: {
      content: Uint8Array;
      other: ReadonlyMap<string, Uint8Array>;
      external: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
      slug: undefined;
    }
  ): unknown;
  serialize(value: unknown): {
    value: unknown;
    content: Uint8Array;
    other: Map<string, Uint8Array>;
  };
};

// Rebuilds a content field's form value from the raw HTML on the bus.
// Parsing with an `other` map missing any image the HTML names silently
// repoints it — edit-sync.ts spells out how — so this assembles the map from
// every source that can hold one, weakest first:
//
//   `ownValues`  the field's value in this form, mined for the bytes of the
//                images it embeds. Pass the entry's *loaded* value as well as
//                its current one: the loaded one stands in for a read of the
//                entry's assets/ directory (it embeds exactly what was on disk
//                at load), which is what covers an image the user has since
//                deleted here but the sender still shows.
//   blob store   images the sender embedded that exist nowhere else yet.
async function contentFromBusValue(
  fieldSchema: ContentFieldSchema,
  html: string,
  assetsDir: string,
  ownValues: readonly unknown[]
): Promise<unknown> {
  const other = new Map<string, Uint8Array>();
  for (const value of ownValues) {
    if (value === undefined) continue;
    for (const [name, bytes] of fieldSchema.serialize(value).other) {
      other.set(name, bytes);
    }
  }
  for (const [name, bytes] of await getPendingBlobsUnder(assetsDir)) {
    other.set(name, bytes);
  }
  return fieldSchema.parse(undefined, {
    content: textEncoder.encode(html),
    other,
    external: new Map(),
    slug: undefined,
  });
}

// The edit-sync bus only carries strings (see edit-sync.ts's PendingEdit) —
// fields.image/fields.file's `null` (no value) is represented on the bus as
// '', the same sentinel bind.ts's paintAssetSpot and the visual editor's
// save.ts already use. fields.array/fields.object's value is JSON-encoded,
// matching the encoding used everywhere else on the bus (see bind.ts's
// parseArrayValue/parseObjectValue and the visual editor's
// Toolbar.tsx/save.ts). fields.text values are always strings already, so
// they pass through as-is.
function toBusValue(
  kind: SyncableFieldKind,
  value: unknown,
  fieldSchema: ComponentSchema
): string | undefined {
  // fields.content travels as raw HTML, the same encoding the visual editor
  // publishes and save.ts reads back. Its embedded image bytes ride along
  // separately — see stashContentBlobs, which the publish effect pairs with
  // this.
  if (kind === 'content') {
    return textDecoder.decode(
      (fieldSchema as unknown as ContentFieldSchema).serialize(value).content
    );
  }
  if (isAssetKind(kind)) {
    if (value === null) return '';
    return typeof value === 'string' ? value : undefined;
  }
  if (kind === 'array') {
    return Array.isArray(value) ? JSON.stringify(value) : undefined;
  }
  if (kind === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? JSON.stringify(value)
      : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

// Every bus-decodable kind — i.e. all but 'content', whose value needs the
// entry's image bytes and an async round trip through the field's own schema
// (contentFromBusValue). Callers dispatch content away before reaching here.
function fromBusValue(
  kind: Exclude<SyncableFieldKind, 'content'>,
  busValue: string
): FieldValue {
  if (isAssetKind(kind)) return busValue === '' ? null : busValue;
  if (kind === 'array') {
    try {
      const parsed = JSON.parse(busValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (kind === 'object') {
    try {
      const parsed = JSON.parse(busValue);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return busValue;
}

// Splices one per-path fields.array/fields.object edit into `current` (the
// base field's own current value) via spliceValueEdit (edit-sync.ts). `field`
// is "baseField.<path>" at any depth (e.g. "cards.0.title" or "info.label").
// A leaf is decoded per its own kind (image '' → null) via fromBusValue,
// matching how the visual editor's save.ts (mergeFieldEdits) and bind.ts read
// the same nested keys.
function applyContainerPathEdit(
  current: unknown,
  baseField: string,
  field: string,
  busValue: string,
  baseSchema: ComponentSchema
): unknown {
  const path = field.slice(baseField.length + 1).split('.');
  return spliceValueEdit(current, path, baseSchema, (leafSchema, prevLeaf) => {
    const leafKind = getSyncableFieldKind(leafSchema);
    // A content field nested inside a container is left alone: nothing
    // publishes such a key today (dry() only tags top-level content spots, and
    // save.ts only resolves a content filename for one), so a key that reaches
    // here is malformed. Writing the raw HTML in as if it were a text leaf
    // would put a string where the form expects an editor state.
    if (leafKind === 'content') return prevLeaf;
    return leafKind ? fromBusValue(leafKind, busValue) : busValue;
  });
}

function LocalSingletonPage(
  props: SingletonPageProps & {
    draft:
      | {
          state: Record<string, unknown>;
          savedAt: Date;
          treeKey: string | undefined;
        }
      | undefined;
  }
) {
  const { singleton, initialFiles, initialState, localTreeKey, config, draft } =
    props;
  const { schema, singletonConfig } = useSingleton(props.singleton);
  const singletonPath = getSingletonPath(config, singleton);

  const [{ state, localTreeKey: localTreeKeyInState }, setState] = useState(
    () => ({
      localTreeKey: localTreeKey,
      state:
        draft?.state ??
        (initialState === null ? getInitialPropsValue(schema) : initialState),
    })
  );

  // Per-field values a *remote* save/reset (another tab, or the visual
  // editor) has already committed to disk — see the subscribeEdits handler
  // below. Merged into `initialState` for the hasChanged/"Unsaved" check so
  // content saved from elsewhere doesn't keep showing as locally unsaved.
  // Reset alongside `state` whenever the tree genuinely reloads (below):
  // the fresh `initialState` prop already carries these values then.
  // Values are whatever the form state holds for that field, content's
  // editor-state object included — this only ever spreads them back over
  // `initialState`, never inspects them.
  const [committedOverrides, setCommittedOverrides] = useState<
    Record<string, unknown>
  >({});

  useShowRestoredDraftMessage(draft, state, localTreeKey);

  if (localTreeKeyInState !== localTreeKey) {
    setState({
      localTreeKey: localTreeKey,
      state:
        initialState === null ? getInitialPropsValue(schema) : initialState,
    });
    setCommittedOverrides({});
  }

  const effectiveInitialState = useMemo(() => {
    if (initialState === null) return null;
    return { ...initialState, ...committedOverrides };
  }, [initialState, committedOverrides]);

  const isCreating = initialState === null;
  const hasChanged =
    useHasChanged({
      initialState: effectiveInitialState,
      state,
      schema,
      slugField: undefined,
    }) || isCreating;

  const changes = useMemo(
    () => computeFieldChanges(schema, effectiveInitialState, state),
    [schema, effectiveInitialState, state]
  );

  useEffect(() => {
    const key = ['singleton', singleton] as const;
    if (hasChanged) {
      const serialized = serializeEntryToFiles({
        basePath: singletonPath,
        format: getSingletonFormat(config, singleton),
        schema: singletonConfig.schema,
        slug: undefined,
        state,
      });
      const files = new Map(serialized.map(x => [x.path, x.contents]));
      const data: s.Infer<typeof storedValSchema> = {
        beforeTreeKey: localTreeKey,
        files,
        savedAt: new Date(),
        version: 1,
      };
      setDraft(key, data);
    } else {
      delDraft(key);
    }
  }, [
    config,
    localTreeKey,
    state,
    hasChanged,
    singleton,
    singletonPath,
    singletonConfig,
  ]);

  const onPreviewPropsChange = useCallback(
    (cb: (state: Record<string, unknown>) => Record<string, unknown>) => {
      setState(state => ({
        localTreeKey: state.localTreeKey,
        state: cb(state.state),
      }));
    },
    []
  );

  // --- Cross-tab / visual-editor sync (fields.text + fields.image) ---
  //
  // `lastSyncedRef` tracks, per field, the value already reflected on the
  // shared edit-sync bus — set either right before we publish it (below) or
  // right after we apply an incoming remote value. Diffing against it
  // (instead of the previous render's `state`) is what stops an incoming
  // remote update from immediately bouncing back out as if it were a local
  // edit.
  const lastSyncedRef = useRef<Record<string, string> | undefined>(undefined);
  // Lets the long-lived subscribeEdits callback below read the *current*
  // state without re-subscribing on every keystroke (state isn't in that
  // effect's deps) — assigned fresh every render.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Embedded content images already written to the bus's blob store — see
  // stashContentBlobs.
  const stashedBlobsRef = useRef<StashedBlobs>(new Set());
  // The values of `field` this form can mine for embedded image bytes when
  // rebuilding an incoming content edit — see contentFromBusValue for why the
  // as-loaded value is in here and not just the current one. Reads through
  // refs: the long-lived subscribeEdits callback below must see the newest of
  // both without re-subscribing.
  const initialStateRef = useRef(initialState);
  initialStateRef.current = initialState;
  const ownContentValues = useCallback(
    (field: string): unknown[] => [
      (initialStateRef.current as Record<string, unknown> | null)?.[field],
      (stateRef.current as Record<string, unknown>)[field],
    ],
    []
  );
  if (!lastSyncedRef.current) {
    lastSyncedRef.current = {};
    for (const [field, fieldSchema] of Object.entries(singletonConfig.schema)) {
      const kind = getSyncableFieldKind(fieldSchema);
      if (!kind) continue;
      const busValue = toBusValue(
        kind,
        (state as Record<string, unknown>)[field],
        fieldSchema
      );
      if (busValue !== undefined) lastSyncedRef.current[field] = busValue;
    }
  }

  // Catch up on mount: a field can already have a pending edit sitting in
  // the shared IndexedDB store — e.g. typed/picked in the visual editor, or
  // in an admin tab that's since been closed — before this tab ever
  // subscribed to the bus, so a live-only subscription would never see it.
  // Apply whatever is already there once, the same way the visual editor's
  // applyPendingEdits() does for the DOM on load.
  //
  // A fields.array/fields.object field can have edits at two granularities:
  // a whole-container replace (field === its base field, published by the
  // visual editor's container dialog) and/or per-path edits (field ===
  // "baseField.<path>", typed inline into a leaf spot at any depth) —
  // processed in two passes so a container edit is applied first and
  // per-path edits then splice on top of it, mirroring save.ts's
  // mergeFieldEdits precedence.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const edits = await getAllEdits();
      if (cancelled) return;
      const relevant = edits.filter(edit => {
        const { type, name } = parseEditKey(edit.key);
        return type === 'singleton' && name === singleton;
      });
      const updates: Record<string, unknown> = {};
      for (const edit of relevant) {
        const { field } = parseEditKey(edit.key);
        const baseField = field.split('.')[0];
        if (field !== baseField) continue;
        const fieldSchema = singletonConfig.schema[baseField];
        const kind = getSyncableFieldKind(fieldSchema);
        if (!kind) continue;
        if (lastSyncedRef.current![field] === edit.value) continue;
        lastSyncedRef.current![field] = edit.value;
        if (kind === 'content') {
          updates[baseField] = await contentFromBusValue(
            fieldSchema as unknown as ContentFieldSchema,
            edit.value,
            `${singletonPath}/assets`,
            ownContentValues(baseField)
          );
          if (cancelled) return;
          continue;
        }
        updates[baseField] = fromBusValue(kind, edit.value);
      }
      for (const edit of relevant) {
        const { field } = parseEditKey(edit.key);
        const baseField = field.split('.')[0];
        if (field === baseField) continue;
        const baseSchema = singletonConfig.schema[baseField];
        const kind = getSyncableFieldKind(baseSchema);
        if (kind !== 'array' && kind !== 'object') continue;
        if (lastSyncedRef.current![field] === edit.value) continue;
        lastSyncedRef.current![field] = edit.value;
        if (!(baseField in updates)) {
          updates[baseField] = (stateRef.current as Record<string, unknown>)[baseField];
        }
        updates[baseField] = applyContainerPathEdit(
          updates[baseField],
          baseField,
          field,
          edit.value,
          baseSchema
        );
      }
      if (Object.keys(updates).length > 0) {
        onPreviewPropsChange(s => ({ ...s, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    singleton,
    singletonConfig.schema,
    singletonPath,
    ownContentValues,
    onPreviewPropsChange,
  ]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [field, fieldSchema] of Object.entries(singletonConfig.schema)) {
      const kind = getSyncableFieldKind(fieldSchema);
      if (!kind) continue;
      const value = (state as Record<string, unknown>)[field];
      // One serialize for a content field, reused for both halves of what it
      // publishes: the HTML body and the embedded image bytes that have to be
      // readable before it. Serializing the whole doc per keystroke is what
      // the visual editor's own inline editor already does.
      const serialized =
        kind === 'content'
          ? (fieldSchema as unknown as ContentFieldSchema).serialize(value)
          : undefined;
      const busValue = serialized
        ? textDecoder.decode(serialized.content)
        : toBusValue(kind, value, fieldSchema);
      if (busValue === undefined) continue;
      if (lastSyncedRef.current![field] === busValue) continue;
      lastSyncedRef.current![field] = busValue;
      // Debounced so fast typing doesn't flood other tabs with a broadcast
      // per keystroke — still "live" at ~200ms (plan.md open question 3).
      // A picked image only fires this once (no keystrokes), so the same
      // debounce just adds one imperceptible 200ms hop for it.
      timers.push(
        setTimeout(async () => {
          if (serialized) {
            await stashContentBlobs(
              serialized.other,
              `${singletonPath}/assets`,
              stashedBlobsRef.current
            );
          }
          publishEdit(editKey('singleton', singleton, field), busValue);
        }, 200)
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [state, singleton, singletonConfig.schema, singletonPath]);

  useEffect(() => {
    return subscribeEdits(msg => {
      if (msg.type === 'set') {
        const { type, name, field } = parseEditKey(msg.key);
        if (type !== 'singleton' || name !== singleton) return;
        // A fields.array/fields.object field's edit can be nested
        // (baseField.<path>, a per-path inline edit at any depth) — the base
        // field is what's tagged in the schema and on the form's own
        // wrapper element either way.
        const baseField = field.split('.')[0];
        const baseSchema = singletonConfig.schema[baseField];
        const kind = getSyncableFieldKind(baseSchema);
        if (!kind) return;
        // Don't stomp on what the user is actively typing — the field's
        // wrapper div carries data-field (object/ui.tsx) for exactly this
        // check. Last-write-wins once they move on: either their own next
        // edit publishes over this, or a later message applies here.
        const fieldEl = document.querySelector(
          `[data-field="${CSS.escape(baseField)}"]`
        );
        if (fieldEl?.contains(document.activeElement)) return;
        lastSyncedRef.current![field] = msg.value;
        if (kind === 'content') {
          // Async, unlike every other kind: rehydrating the body's images
          // means a read from the blob store first. Ordering against a
          // concurrent message is already handled the same way as elsewhere —
          // lastSyncedRef is stamped above, and a later message simply
          // publishes over whatever this resolves to.
          contentFromBusValue(
            baseSchema as unknown as ContentFieldSchema,
            msg.value,
            `${singletonPath}/assets`,
            ownContentValues(baseField)
          ).then(next => {
            onPreviewPropsChange(s => ({ ...s, [baseField]: next }));
          });
          return;
        }
        if (field === baseField) {
          onPreviewPropsChange(s => ({
            ...s,
            [baseField]: fromBusValue(kind, msg.value),
          }));
          return;
        }
        // Per-path array/object edit ("baseField.<path>" at any depth) —
        // splice the new value into the container's current state rather
        // than replacing the whole field.
        if (kind !== 'array' && kind !== 'object') return;
        onPreviewPropsChange(s => {
          const current = (s as Record<string, unknown>)[baseField];
          return {
            ...s,
            [baseField]: applyContainerPathEdit(current, baseField, field, msg.value, baseSchema),
          };
        });
        return;
      }
      // 'delete' / 'clear' — the field(s) are no longer pending anywhere,
      // because they were just saved (or discarded) on another tab/surface.
      // Whatever this tab currently shows for them is that same saved/
      // reverted value (it already tracked live 'set' messages up to this
      // point), so it becomes the new "nothing to save" baseline — otherwise
      // the Unsaved badge and the full-entry draft (both driven by
      // hasChanged, which compares against `initialState`) would keep
      // treating already-committed content as locally unsaved forever.
      const fields =
        msg.type === 'delete'
          ? (() => {
              const { type, name, field } = parseEditKey(msg.key);
              return type === 'singleton' && name === singleton ? [field] : [];
            })()
          : Object.keys(singletonConfig.schema);
      setCommittedOverrides(prev => {
        let next: Record<string, unknown> | undefined;
        for (const field of fields) {
          const kind = getSyncableFieldKind(singletonConfig.schema[field]);
          if (!kind) continue;
          const value = (stateRef.current as Record<string, unknown>)[field];
          // Shape-check what the bus-decodable kinds are supposed to hold.
          // 'content' is exempt: its value is the editor's own state object,
          // which this layer deliberately treats as opaque.
          if (
            (kind === 'text' && typeof value !== 'string') ||
            (isAssetKind(kind) && typeof value !== 'string' && value !== null) ||
            (kind === 'array' && !Array.isArray(value)) ||
            (kind === 'object' &&
              (typeof value !== 'object' || value === null || Array.isArray(value)))
          ) {
            continue;
          }
          if (prev[field] === value) continue;
          next ??= { ...prev };
          next[field] = value;
        }
        return next ?? prev;
      });
    });
  }, [
    singleton,
    singletonConfig.schema,
    singletonPath,
    ownContentValues,
    onPreviewPropsChange,
  ]);

  const previewProps = usePreviewProps(
    schema,
    onPreviewPropsChange,
    state as Record<string, unknown>
  );

  const formatInfo = getSingletonFormat(config, singleton);
  const [updateResult, _update, resetUpdateItem] = useUpsertItem({
    state,
    initialFiles,
    config,
    schema: singletonConfig.schema,
    basePath: singletonPath,
    format: formatInfo,
    currentLocalTreeKey: localTreeKey,
    slug: undefined,
  });
  const update = useEventCallback(_update);

  // A successful save means this singleton's synced fields now match what's
  // pending — drop those keys from the shared edit-sync bus so a
  // visual-editor tab that had them queued (from live-typed/picked edits it
  // received earlier) stops treating already-saved content as unreviewed.
  useEffect(() => {
    if (updateResult.kind !== 'updated') return;
    for (const [field, fieldSchema] of Object.entries(singletonConfig.schema)) {
      const kind = getSyncableFieldKind(fieldSchema);
      // Content included: this tab now mirrors a content field's pending edit
      // into its own form state, so the save above wrote that same body out
      // rather than the stale one it used to. Dropping the key is what makes
      // the edit stop showing as unreviewed in the visual editor.
      if (kind) {
        publishDelete(editKey('singleton', singleton, field));
      }
    }
  }, [updateResult, singleton, singletonConfig.schema]);

  const resetState = useMemo(
    () =>
      effectiveInitialState === null
        ? getInitialPropsValue(schema)
        : effectiveInitialState,
    [effectiveInitialState, schema]
  );
  const onReset = () =>
    setState({ localTreeKey: localTreeKey, state: resetState });
  const onRevertField = useCallback(
    (key: string) => {
      setState(s => ({
        localTreeKey: s.localTreeKey,
        state: { ...s.state, [key]: resetState[key] },
      }));
    },
    [resetState]
  );
  return (
    <SingletonPageInner
      {...props}
      hasChanged={hasChanged}
      onReset={onReset}
      onUpdate={update}
      onResetUpdateItem={resetUpdateItem}
      updateResult={updateResult}
      state={state}
      previewProps={previewProps}
      changes={changes}
      onRevertField={onRevertField}
    />
  );
}

const storedValSchema = s.type({
  version: s.literal(1),
  savedAt: s.date(),
  beforeTreeKey: s.optional(s.string()),
  files: s.map(s.string(), s.instance(Uint8Array)),
});

function SingletonPageWrapper(props: { singleton: string; config: Config }) {
  const singletonConfig = props.config.singletons?.[props.singleton];
  if (!singletonConfig) notFound();
  const header = (
    <PageHeader>
      <Heading elementType="h1" id="page-title" size="small">
        {singletonConfig.label}
      </Heading>
    </PageHeader>
  );
  const format = useMemo(
    () => getSingletonFormat(props.config, props.singleton),
    [props.config, props.singleton]
  );

  const dirpath = getSingletonPath(props.config, props.singleton);

  const draftData = useData(
    useCallback(async () => {
      const raw = await getDraft(['singleton', props.singleton]);
      if (!raw) throw new Error('No draft found');
      const stored = storedValSchema.create(raw);
      const parsed = parseEntry(
        {
          dirpath,
          format,
          schema: singletonConfig.schema,
          slug: undefined,
        },
        stored.files
      );
      return {
        state: parsed.initialState,
        savedAt: stored.savedAt,
        treeKey: stored.beforeTreeKey,
      };
    }, [dirpath, format, props.singleton, singletonConfig.schema])
  );

  const itemData = useItemData({
    config: props.config,
    dirpath,
    schema: singletonConfig.schema,
    format,
    slug: undefined,
  });
  if (itemData.kind === 'error') {
    return (
      <PageRoot>
        {header}
        <PageBody>
          <Notice margin="xxlarge" tone="critical">
            {itemData.error.message}
          </Notice>
        </PageBody>
      </PageRoot>
    );
  }

  if (itemData.kind === 'loading' || draftData.kind === 'loading') {
    return (
      <PageRoot>
        {header}
        <PageBody>
          <Flex
            alignItems="center"
            justifyContent="center"
            minHeight="scale.3000"
          >
            <ProgressCircle
              aria-label={`Loading ${singletonConfig.label}`}
              isIndeterminate
              size="large"
            />
          </Flex>
        </PageBody>
      </PageRoot>
    );
  }

  return (
    <LocalSingletonPage
      singleton={props.singleton}
      config={props.config}
      initialState={
        itemData.data === 'not-found' ? null : itemData.data.initialState
      }
      initialFiles={
        itemData.data === 'not-found' ? [] : itemData.data.initialFiles
      }
      localTreeKey={
        itemData.data === 'not-found' ? undefined : itemData.data.localTreeKey
      }
      draft={draftData.kind === 'loaded' ? draftData.data : undefined}
    />
  );
}

export { SingletonPageWrapper as SingletonPage };
