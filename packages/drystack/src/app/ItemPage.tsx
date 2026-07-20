import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { isHotkey } from "is-hotkey";
import {
  CSSProperties,
  FormEvent,
  Key,
  ReactElement,
  ReactNode,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as s from "superstruct";

import { ActionGroup, Item } from "@keystar/ui/action-group";
import { Badge } from "@keystar/ui/badge";
import { Button, ButtonGroup } from "@keystar/ui/button";
import { Combobox } from "@keystar/ui/combobox";
import { AlertDialog, Dialog, DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { copyPlusIcon } from "@keystar/ui/icon/icons/copyPlusIcon";
import { clipboardCopyIcon } from "@keystar/ui/icon/icons/clipboardCopyIcon";
import { clipboardPasteIcon } from "@keystar/ui/icon/icons/clipboardPasteIcon";
import { externalLinkIcon } from "@keystar/ui/icon/icons/externalLinkIcon";
import { githubIcon } from "@keystar/ui/icon/icons/githubIcon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { Box, Flex } from "@keystar/ui/layout";
import { Notice } from "@keystar/ui/notice";
import { ProgressCircle } from "@keystar/ui/progress";
import { Radio, RadioGroup } from "@keystar/ui/radio";
import { Content } from "@keystar/ui/slots";
import {
  breakpointQueries,
  css,
  tokenSchema,
  useMediaQuery,
} from "@keystar/ui/style";
import { TextField } from "@keystar/ui/text-field";
import { Heading, Text } from "@keystar/ui/typography";

import { Config } from "../config";
import { ComponentSchema, GenericPreviewProps, ObjectField } from "../form/api";
import { clientSideValidateProp } from "../form/errors";
import { useEventCallback } from "../form/fields/use-event-callback";

import {
  prettyErrorForCreateBranchMutation,
  useCreateBranchMutation,
} from "./branch-selection";
import {
  EntryDirectoryProvider,
  FormForEntry,
  containerWidthForEntryLayout,
} from "./entry-form";
import { ForkRepoDialog } from "./fork-repo";
import l10nMessages from "./l10n";
import { NotFoundBoundary, notFound } from "./not-found";
import {
  getDataFileExtension,
  getPathPrefix,
  type EntryRef,
} from "./path-utils";
import { useEntryEditSync } from "./useEntryEditSync";
import { useRouter } from "./router";
import { useScrollToFieldParam } from "./useScrollToFieldParam";
import { HeaderBreadcrumbs } from "./shell/HeaderBreadcrumbs";
import { useConfig } from "./shell/context";
import { AiLockProvider } from "./ai/lock-context";
import { MagicWriteButton, useAiEntryDescription } from "./ai/MagicWriteButton";
import { useMagicWrite } from "./ai/useMagicWrite";
import { useBaseCommit, useCurrentBranch, useRepoInfo } from "./shell/data";
import { PageBody, PageHeader, PageRoot } from "./shell/page";
import { useSlugFieldInfo } from "./slugs";
import { useSlugsInCollection } from "./useSlugsInCollection";
import { delDraft, getDraft, setDraft } from "./persistence";
import {
  serializeEntryToFiles,
  useDeleteItem,
  useUpsertItem,
} from "./updating";
import { useHasChanged } from "./useHasChanged";
import {
  ChangePreviewDialog,
  type FieldChange,
} from "./change-preview/ChangePreviewDialog";
import { computeFieldChanges } from "./change-preview/computeFieldChanges";
import { AdminImageThumb } from "./change-preview/AdminImageThumb";
import { parseEntry, useItemData } from "./useItemData";
import { ResetEntryDataButton } from "./reset-entry-data";
import {
  getBranchPrefix,
  getCollection,
  getCollectionFormat,
  getCollectionItemPath,
  getRepoUrl,
  getSlugFromState,
  isGitHubConfig,
  useShowRestoredDraftMessage,
} from "./utils";
import { DataState, useData, suspendOnData } from "./useData";
import { useCollection, usePreviewProps } from "./preview-props";
import { ErrorBoundary } from "./error-boundary";
import { copyEntryToClipboard, getPastedEntry } from "./entry-clipboard";
import { setValueToPreviewProps } from "../form/get-value";
import { toastQueue } from "@keystar/ui/toast";

type ItemPageProps = {
  collection: string;
  config: Config;
  initialFiles: string[];
  initialState: Record<string, unknown>;
  itemSlug: string;
  localTreeKey: string;
  basePath: string;
};

// Renders inline paths/URLs in dialog copy with the admin's code font token
// instead of the browser's default monospace stack (raw `<code>` tags don't
// pick up @keystar/ui's typography system).
const codeText = css({
  fontFamily: tokenSchema.typography.fontFamily.code,
});

// AlertDialog hardcodes `size="small"` with no way to opt into a larger
// size - override the width it reads via CSS custom property directly
// (see @keystar/ui's Dialog.tsx: `width: 'var(--dialog-width)'`), since
// `UNSAFE_style` on AlertDialog passes straight through to the inline
// style of the underlying Dialog and beats the size-driven class.
const wideDialogStyle = {
  "--dialog-width": tokenSchema.size.dialog.medium,
} as CSSProperties;

const storedValSchema = s.type({
  version: s.literal(1),
  savedAt: s.date(),
  slug: s.string(),
  beforeTreeKey: s.string(),
  files: s.map(s.string(), s.instance(Uint8Array)),
});

function ItemPageInner(
  props: ItemPageProps & {
    onUpdate: (options?: {
      branch?: string;
      sha?: string;
      redirect?: { from: string; to: string };
    }) => Promise<boolean>;
    onReset: () => void;
    updateResult: ReturnType<typeof useUpsertItem>[0];
    onResetUpdateItem: () => void;
    previewProps: GenericPreviewProps<
      ObjectField<Record<string, ComponentSchema>>,
      undefined
    >;
    hasChanged: boolean;
    state: Record<string, unknown>;
    changes: FieldChange[];
    onRevertField: (key: string) => void;
    magicWrite: ReturnType<typeof useMagicWrite>;
  },
) {
  const {
    collection,
    config,
    itemSlug,
    updateResult,
    onUpdate: parentOnUpdate,
  } = props;
  const { collectionConfig, schema } = useCollection(collection);
  const aiEntryDescription = useAiEntryDescription(config, collection);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const router = useRouter();
  useScrollToFieldParam();
  const baseCommit = useBaseCommit();
  const currentBasePath = getCollectionItemPath(config, collection, itemSlug);
  const formatInfo = getCollectionFormat(config, collection);
  const currentBranch = useCurrentBranch();
  const repoInfo = useRepoInfo();
  const [forceValidation, setForceValidation] = useState(false);
  const urlForSlug = (slug: string) =>
    collectionConfig.previewUrl
      ? collectionConfig.previewUrl
          .replace("{slug}", slug)
          .replace("{branch}", currentBranch)
      : undefined;
  const previewHref = urlForSlug(props.itemSlug);
  const { push, replace } = router;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingRename, setPendingRename] = useState<{
    from: string;
    to: string;
  } | null>(null);
  // The redirect decision the user last made (or explicitly declined) for
  // this rename, kept around so a subsequent branch-protection/fork retry -
  // which re-invokes the save - doesn't silently drop it.
  const [confirmedRedirect, setConfirmedRedirect] = useState<
    { from: string; to: string } | undefined
  >(undefined);

  const slugInfo = useSlugFieldInfo(collection, itemSlug);

  const [deleteResult, deleteItem, resetDeleteItem] = useDeleteItem({
    initialFiles: props.initialFiles,
    storage: config.storage,
    basePath: currentBasePath,
  });

  const onDelete = useEventCallback(
    async (redirect?: { from: string; to: string }) => {
      // TODO: delete multiplayer draft
      if (await deleteItem({ redirect })) {
        push(`${props.basePath}/collection/${encodeURIComponent(collection)}`);
      }
    },
  );

  const onDuplicate = () => {
    push(
      `${props.basePath}/collection/${encodeURIComponent(
        collection,
      )}/create?duplicate=${itemSlug}`,
    );
  };
  const isSavingDisabled = updateResult.kind === "loading" || !props.hasChanged;

  // build tracking now lives on the Deploy button (deploy/DeployButton.tsx):
  // saves commit to the editor's brand branch, which never triggers a
  // Cloudflare build on its own - only merging a brand into the default
  // branch does. See plan/brand.md §11.

  // Saves the entry, optionally folding a `from → to` 301 into the same
  // commit (see useUpsertItem's `redirect` option in updating.tsx). Shared by
  // the direct-save path below and by the rename-confirm dialog's actions.
  const saveAndMaybeNavigate = useEventCallback(
    async (redirect?: { from: string; to: string }) => {
      const slug = getSlugFromState(collectionConfig, props.state);
      const hasUpdated = await parentOnUpdate(
        redirect ? { redirect } : undefined,
      );
      if (hasUpdated && slug !== itemSlug) {
        replace(
          `${props.basePath}/collection/${encodeURIComponent(
            collection,
          )}/item/${encodeURIComponent(slug)}`,
        );
      }
      return hasUpdated;
    },
  );

  const onUpdate = useEventCallback(async () => {
    if (isSavingDisabled) return false;
    if (!clientSideValidateProp(schema, props.state, slugInfo)) {
      setForceValidation(true);
      return false;
    }
    const slug = getSlugFromState(collectionConfig, props.state);
    // Renaming a published entry silently 404s its old URL - hold off on
    // saving and ask whether to leave a 301 behind (only possible when the
    // collection declares `previewUrl`, since that's how we derive the
    // public path from a slug; drystack itself doesn't know the site's
    // routing).
    if (slug !== itemSlug && collectionConfig.previewUrl) {
      setPendingRename({ from: urlForSlug(itemSlug)!, to: urlForSlug(slug)! });
      return false;
    }
    setConfirmedRedirect(undefined);
    return saveAndMaybeNavigate();
  });

  const onCopy = useEventCallback(() => {
    copyEntryToClipboard(props.state, formatInfo, collectionConfig.schema, {
      field: collectionConfig.slugField,
      value: getSlugFromState(collectionConfig, props.state),
    });
  });

  const onPaste = useEventCallback(async () => {
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
      toastQueue.positive(stringFormatter.format("entryPastedToast"), {
        shouldCloseOnAction: true,
        actionLabel: stringFormatter.format("undo"),
        onAction: () => {
          setValueToPreviewProps(props.state, props.previewProps);
        },
      });
    }
  });

  const viewHref =
    config.storage.kind !== "local" && repoInfo
      ? `${getRepoUrl(repoInfo)}${
          formatInfo.dataLocation === "index"
            ? `/tree/${currentBranch}/${
                getPathPrefix(config.storage) ?? ""
              }${currentBasePath}`
            : `/blob/${currentBranch}/${
                getPathPrefix(config.storage) ?? ""
              }${currentBasePath}${getDataFileExtension(formatInfo)}`
        }`
      : undefined;

  const formID = "item-edit-form";

  // allow shortcuts "cmd+s" and "ctrl+s" to save
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (updateResult.kind === "loading") {
        return;
      }
      if (isHotkey("mod+s", event)) {
        event.preventDefault();
        onUpdate();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [updateResult.kind, onUpdate]);

  return (
    <AiLockProvider
      lockedKeys={props.magicWrite.streamingKeys}
      fieldMagicWrite={
        aiEntryDescription
          ? {
              entryLabel: collectionConfig.label,
              schema: schema.fields,
              state: props.state,
              magicWrite: props.magicWrite,
            }
          : null
      }
    >
      <ItemPageShell
        headerActions={
          <HeaderActions
            formID={formID}
            isLoading={updateResult.kind === "loading"}
            hasChanged={props.hasChanged}
            onDelete={onDelete}
            onOpenReview={() => setReviewOpen(true)}
            collection={collection}
            itemSlug={itemSlug}
            previewUrl={collectionConfig.previewUrl}
            urlForSlug={urlForSlug}
            onDuplicate={onDuplicate}
            onCopy={onCopy}
            onPaste={onPaste}
            viewHref={viewHref}
            previewHref={previewHref}
            magicWrite={props.magicWrite}
            schema={schema.fields}
            state={props.state}
            entryLabel={collectionConfig.label}
          />
        }
        {...props}
      >
        {updateResult.kind === "error" && (
          <Notice tone="critical">{updateResult.error.message}</Notice>
        )}
        {deleteResult.kind === "error" && (
          <Notice tone="critical">{deleteResult.error.message}</Notice>
        )}
        <Box
          id={formID}
          height="100%"
          minHeight={0}
          minWidth={0}
          elementType="form"
          onSubmit={(event: FormEvent) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            onUpdate();
          }}
        >
          <EntryDirectoryProvider value={currentBasePath}>
            <FormForEntry
              previewProps={props.previewProps as any}
              forceValidation={forceValidation}
              entryLayout={collectionConfig.entryLayout}
              formatInfo={formatInfo}
              slugField={slugInfo}
            />
          </EntryDirectoryProvider>
        </Box>
        <DialogContainer onDismiss={() => setPendingRename(null)}>
          {pendingRename && (
            <AlertDialog
              title={stringFormatter.format("changeEntryUrlTitle")}
              tone="neutral"
              cancelLabel={stringFormatter.format("cancel")}
              secondaryActionLabel={stringFormatter.format("renameWithoutRedirect")}
              primaryActionLabel={stringFormatter.format("create301Redirect")}
              autoFocusButton="primary"
              UNSAFE_style={wideDialogStyle}
              onPrimaryAction={() => {
                const redirect = pendingRename;
                setPendingRename(null);
                setConfirmedRedirect(redirect);
                saveAndMaybeNavigate(redirect);
              }}
              onSecondaryAction={() => {
                setPendingRename(null);
                setConfirmedRedirect(undefined);
                saveAndMaybeNavigate();
              }}
            >
              <Text>
                {stringFormatter.format("changeUrlBodyIntro")}{" "}
                <Text elementType="span" UNSAFE_className={codeText}>
                  {pendingRename.from}
                </Text>
                . {stringFormatter.format("changeUrlBodyMiddle")}{" "}
                <Text elementType="span" UNSAFE_className={codeText}>
                  {pendingRename.to}
                </Text>{" "}
                {stringFormatter.format("changeUrlBodyOutro")}
              </Text>
            </AlertDialog>
          )}
        </DialogContainer>
        <DialogContainer
          // ideally this would be a popover on desktop but using a DialogTrigger wouldn't work since
          // this doesn't open on click but after doing a network request and it failing and manually wiring about a popover and modal would be a pain
          onDismiss={props.onResetUpdateItem}
        >
          {updateResult.kind === "needs-new-branch" && (
            <CreateBranchDuringUpdateDialog
              branchOid={baseCommit}
              onCreate={async (newBranch) => {
                const itemBasePath = `${
                  router.basePath
                }/branch/${encodeURIComponent(
                  newBranch,
                )}/collection/${encodeURIComponent(collection)}/item/`;
                router.push(itemBasePath + encodeURIComponent(itemSlug));
                const slug = getSlugFromState(collectionConfig, props.state);

                const hasUpdated = await parentOnUpdate({
                  branch: newBranch,
                  sha: baseCommit,
                  redirect: confirmedRedirect,
                });
                if (hasUpdated && slug !== itemSlug) {
                  router.replace(itemBasePath + encodeURIComponent(slug));
                }
              }}
              reason={updateResult.reason}
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
          {updateResult.kind === "needs-fork" &&
            isGitHubConfig(props.config) && (
              <ForkRepoDialog
                onCreate={async () => {
                  const slug = getSlugFromState(collectionConfig, props.state);
                  const hasUpdated = await parentOnUpdate({
                    redirect: confirmedRedirect,
                  });
                  if (hasUpdated && slug !== itemSlug) {
                    router.replace(
                      `${props.basePath}/collection/${encodeURIComponent(
                        collection,
                      )}/item/${encodeURIComponent(slug)}`,
                    );
                  }
                }}
                onDismiss={props.onResetUpdateItem}
                config={props.config}
              />
            )}
        </DialogContainer>
        <DialogContainer
          // ideally this would be a popover on desktop but using a DialogTrigger
          // wouldn't work since this doesn't open on click but after doing a
          // network request and it failing and manually wiring about a popover
          // and modal would be a pain
          onDismiss={resetDeleteItem}
        >
          {deleteResult.kind === "needs-fork" &&
            isGitHubConfig(props.config) && (
              <ForkRepoDialog
                onCreate={async () => {
                  await deleteItem();
                  router.push(
                    `${props.basePath}/collection/${encodeURIComponent(
                      collection,
                    )}`,
                  );
                }}
                onDismiss={resetDeleteItem}
                config={props.config}
              />
            )}
        </DialogContainer>
        <DialogContainer onDismiss={() => setReviewOpen(false)}>
          {reviewOpen && (
            <ChangePreviewDialog
              changes={props.changes}
              onDelete={props.onRevertField}
              onResetAll={props.onReset}
              renderImage={(path: string) => <AdminImageThumb path={path} />}
            />
          )}
        </DialogContainer>
      </ItemPageShell>
    </AiLockProvider>
  );
}

function LocalItemPage(
  props: ItemPageProps & {
    draft:
      | { state: Record<string, unknown>; savedAt: Date; treeKey: string }
      | undefined;
  },
) {
  const {
    collection,
    config,
    initialFiles,
    initialState,
    localTreeKey,
    draft,
  } = props;
  const { collectionConfig, schema } = useCollection(collection);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const magicWriteEntry = useMemo(
    () => ({ kind: "collection" as const, key: collection }),
    [collection],
  );

  const [{ state, localTreeKey: localTreeKeyInState }, setState] = useState({
    state: draft?.state ?? initialState,
    localTreeKey,
  });

  // Per-field values a *remote* save/reset (another tab, or the visual
  // editor) has already committed to disk - see useEntryEditSync. Merged
  // into `initialState` for the hasChanged/"Unsaved" check so content saved
  // from elsewhere doesn't keep showing as locally unsaved. Reset alongside
  // `state` whenever the tree genuinely reloads (below): the fresh
  // `initialState` prop already carries these values then. Mirrors
  // SingletonPage.tsx's identical pattern.
  const [committedOverrides, setCommittedOverrides] = useState<
    Record<string, unknown>
  >({});

  useShowRestoredDraftMessage(draft, state, localTreeKey);

  if (localTreeKeyInState !== localTreeKey) {
    setState({ state: initialState, localTreeKey });
    setCommittedOverrides({});
  }

  const effectiveInitialState = useMemo(
    () => ({ ...initialState, ...committedOverrides }),
    [initialState, committedOverrides],
  );

  const onPreviewPropsChange = useCallback(
    (
      stateUpdater: (state: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      setState((state) => ({
        localTreeKey: state.localTreeKey,
        state: stateUpdater(state.state),
      }));
    },
    [],
  );

  const previewProps = usePreviewProps(schema, onPreviewPropsChange, state);

  const hasChanged = useHasChanged({
    initialState: effectiveInitialState,
    schema,
    state,
    slugField: collectionConfig.slugField,
  });

  const changes = useMemo(
    () =>
      computeFieldChanges(schema, effectiveInitialState, state, stringFormatter),
    [schema, effectiveInitialState, state, stringFormatter],
  );

  const slug = getSlugFromState(collectionConfig, state);
  const formatInfo = getCollectionFormat(config, collection);
  const futureBasePath = getCollectionItemPath(config, collection, slug);
  // The entry's *current* on-disk directory (URL slug), not futureBasePath
  // (live form-state slug, which only matters once a rename actually saves)
  // - the bus is keyed by where the entry lives right now, so its identity
  // can't shift mid-edit just because the user is typing a new title. See
  // MVP1's "slug is a fixed key" scope: rename isn't wired up yet.
  const entryDir = getCollectionItemPath(config, collection, props.itemSlug);
  const itemRef: EntryRef = useMemo(
    () => ({ type: "collection", name: collection, slug: props.itemSlug }),
    [collection, props.itemSlug],
  );
  const [updateResult, _update, resetUpdateItem] = useUpsertItem({
    state,
    initialFiles,
    config,
    schema: collectionConfig.schema,
    basePath: futureBasePath,
    format: formatInfo,
    currentLocalTreeKey: localTreeKey,
    slug: { field: collectionConfig.slugField, value: slug },
  });

  // See useEntryEditSync's own doc comment for the full mechanics (mount
  // catch-up, debounced publish, live subscribeEdits, and dropping
  // now-committed keys after a save) - shared verbatim with
  // LocalSingletonPage (SingletonPage.tsx), so a collection item now
  // participates in the same cross-tab/visual-editor bus a singleton
  // already did. Called here (after useUpsertItem) so `updateResult` is
  // available for the last of those steps.
  useEntryEditSync({
    ref: itemRef,
    schema: collectionConfig.schema,
    entryDir,
    state,
    onPreviewPropsChange,
    // The raw as-loaded value, not effectiveInitialState - matches
    // LocalSingletonPage's identical call. This only feeds ownContentValues
    // (mining embedded-image bytes from what was actually on disk at load),
    // never the hasChanged/"Unsaved" baseline, so it must stay the fixed
    // as-loaded snapshot rather than the moving committedOverrides-merged one.
    initialState,
    committedOverrides,
    setCommittedOverrides,
    updateResult,
  });

  const resetState = effectiveInitialState;

  useEffect(() => {
    const key = ["collection", collection, props.itemSlug] as const;
    if (hasChanged) {
      const serialized = serializeEntryToFiles({
        basePath: futureBasePath,
        format: getCollectionFormat(config, collection),
        schema: collectionConfig.schema,
        slug: { field: collectionConfig.slugField, value: slug },
        state,
      });
      const files = new Map<string, Uint8Array<ArrayBuffer>>(
        serialized.map((x) => [x.path, x.contents as Uint8Array<ArrayBuffer>]),
      );
      const data: s.Infer<typeof storedValSchema> = {
        beforeTreeKey: localTreeKey,
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
    collection,
    collectionConfig,
    config,
    futureBasePath,
    localTreeKey,
    props.itemSlug,
    slug,
    state,
    hasChanged,
  ]);
  const update = useEventCallback(_update);

  const magicWrite = useMagicWrite({
    entry: magicWriteEntry,
    schema: schema.fields,
    onStateChange: onPreviewPropsChange,
  });

  const onReset = () => {
    setState({ state: resetState, localTreeKey });
  };
  const onRevertField = useCallback(
    (key: string) => {
      setState((s) => ({
        localTreeKey: s.localTreeKey,
        state: { ...s.state, [key]: resetState[key] },
      }));
    },
    [resetState],
  );
  return (
    <ItemPageInner
      {...props}
      onUpdate={update}
      onReset={onReset}
      updateResult={updateResult}
      onResetUpdateItem={resetUpdateItem}
      previewProps={previewProps}
      state={state}
      hasChanged={hasChanged}
      changes={changes}
      onRevertField={onRevertField}
      magicWrite={magicWrite}
    />
  );
}

function HeaderActions(props: {
  formID: string;
  hasChanged: boolean;
  isLoading: boolean;
  onDelete: (redirect?: { from: string; to: string }) => void;
  onOpenReview: () => void;
  collection: string;
  itemSlug: string;
  previewUrl?: string;
  urlForSlug: (slug: string) => string | undefined;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  previewHref?: string;
  viewHref?: string;
  magicWrite: ReturnType<typeof useMagicWrite>;
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
  entryLabel: string;
}) {
  let {
    formID,
    hasChanged,
    isLoading,
    onDelete,
    onOpenReview,
    collection,
    itemSlug,
    previewUrl,
    urlForSlug,
    onDuplicate,
    onCopy,
    onPaste,
    previewHref,
    viewHref,
  } = props;
  const isBelowDesktop = useMediaQuery(breakpointQueries.below.desktop);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const aiEntryDescription = useAiEntryDescription(useConfig(), collection);
  const [deleteAlertIsOpen, setDeleteAlertOpen] = useState(false);
  const [duplicateAlertIsOpen, setDuplicateAlertOpen] = useState(false);
  const otherSlugs = useSlugsInCollection(collection).filter(
    (s) => s !== itemSlug,
  );
  const itemUrl = previewUrl ? urlForSlug(itemSlug) : undefined;
  const parentUrl = previewUrl
    ? previewUrl.split("{slug}")[0].replace(/\/$/, "") || "/"
    : undefined;
  const menuActions = useMemo(() => {
    type ActionType = {
      icon: ReactElement;
      isDisabled?: boolean;
      key: Key;
      label: string;
      href?: string;
      target?: string;
      rel?: string;
    };
    let items: ActionType[] = [
      {
        key: "delete",
        label: stringFormatter.format("deleteEntryMenu"),
        icon: trash2Icon,
      },
      {
        key: "copy",
        label: stringFormatter.format("copyEntry"),
        icon: clipboardCopyIcon,
      },
      {
        key: "paste",
        label: stringFormatter.format("pasteEntry"),
        icon: clipboardPasteIcon,
      },
      {
        key: "duplicate",
        label: stringFormatter.format("duplicateEntryMenu"),
        icon: copyPlusIcon,
      },
    ];
    if (previewHref) {
      items.push({
        key: "preview",
        label: stringFormatter.format("preview"),
        icon: externalLinkIcon,
        href: previewHref,
        target: "_blank",
        rel: "noopener noreferrer",
      });
    }
    if (viewHref) {
      items.push({
        key: "view",
        label: stringFormatter.format("viewOnGithub"),
        icon: githubIcon,
        href: viewHref,
        target: "_blank",
        rel: "noopener noreferrer",
      });
    }

    return items;
  }, [previewHref, viewHref, stringFormatter]);

  const indicatorElement = (() => {
    if (isLoading) {
      return (
        <ProgressCircle
          aria-label={stringFormatter.format("savingChanges")}
          isIndeterminate
          size="small"
          alignSelf="center"
        />
      );
    }

    if (hasChanged) {
      return (
        <button
          type="button"
          onClick={onOpenReview}
          aria-label={stringFormatter.format("reviewChanges")}
          style={{
            all: "unset",
            display: "inline-flex",
            cursor: "pointer",
          }}
        >
          {isBelowDesktop ? (
            <Box
              backgroundColor="pendingEmphasis"
              height="scale.75"
              width="scale.75"
              borderRadius="full"
            >
              <Text visuallyHidden>Unsaved</Text>
            </Box>
          ) : (
            <Badge tone="pending">Unsaved</Badge>
          )}
        </button>
      );
    }

    return null;
  })();

  return (
    <Flex alignItems="center" gap={{ mobile: "small", tablet: "regular" }}>
      {indicatorElement}
      <ActionGroup
        buttonLabelBehavior="hide"
        overflowMode="collapse"
        prominence="low"
        density="compact"
        maxWidth={isBelowDesktop ? "element.regular" : undefined} // force switch to action menu on small devices
        items={menuActions}
        onAction={(key) => {
          switch (key) {
            case "delete":
              setDeleteAlertOpen(true);
              break;
            case "copy":
              onCopy();
              break;
            case "paste":
              onPaste();
              break;
            case "duplicate":
              if (hasChanged) {
                setDuplicateAlertOpen(true);
              } else {
                onDuplicate();
              }
              break;
          }
        }}
      >
        {(item) => (
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
      {aiEntryDescription && (
        <MagicWriteButton
          entryLabel={props.entryLabel}
          schema={props.schema}
          state={props.state}
          magicWrite={props.magicWrite}
        />
      )}
      <Button
        form={formID}
        isPending={isLoading}
        isDisabled={!hasChanged}
        prominence="high"
        type="submit"
      >
        {stringFormatter.format("save")}
      </Button>
      <DialogContainer onDismiss={() => setDeleteAlertOpen(false)}>
        {deleteAlertIsOpen && (
          <DeleteEntryDialog
            itemUrl={itemUrl}
            parentUrl={parentUrl}
            otherSlugs={otherSlugs}
            urlForSlug={urlForSlug}
            onDelete={(redirect) => {
              setDeleteAlertOpen(false);
              onDelete(redirect);
            }}
            onDismiss={() => setDeleteAlertOpen(false)}
          />
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => setDuplicateAlertOpen(false)}>
        {duplicateAlertIsOpen && (
          <AlertDialog
            title={stringFormatter.format("saveAndDuplicateTitle")}
            tone="neutral"
            cancelLabel={stringFormatter.format("cancel")}
            primaryActionLabel={stringFormatter.format("saveAndDuplicateAction")}
            autoFocusButton="primary"
            onPrimaryAction={onDuplicate}
          >
            {stringFormatter.format("saveAndDuplicateBody")}
          </AlertDialog>
        )}
      </DialogContainer>
    </Flex>
  );
}

// Deleting a published entry silently 404s its old URL, same as a rename.
// `itemUrl`/`parentUrl` are only defined when the collection declares
// `previewUrl` (see ItemPageInner) - without a public URL there's nothing to
// redirect *from*, so the picker is skipped and this behaves like a plain
// delete confirmation.
function DeleteEntryDialog(props: {
  itemUrl?: string;
  parentUrl?: string;
  otherSlugs: string[];
  urlForSlug: (slug: string) => string | undefined;
  onDelete: (redirect?: { from: string; to: string }) => void;
  onDismiss: () => void;
}) {
  const [target, setTarget] = useState<"none" | "parent" | "entry">("none");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const redirect = (() => {
    if (!props.itemUrl) return undefined;
    if (target === "parent" && props.parentUrl) {
      return { from: props.itemUrl, to: props.parentUrl };
    }
    if (target === "entry" && selectedSlug) {
      const to = props.urlForSlug(selectedSlug);
      return to ? { from: props.itemUrl, to } : undefined;
    }
    return undefined;
  })();

  return (
    <AlertDialog
      title={stringFormatter.format("deleteEntryDialogTitle")}
      tone="critical"
      cancelLabel={stringFormatter.format("cancel")}
      primaryActionLabel={stringFormatter.format("yesDeleteAction")}
      isPrimaryActionDisabled={target === "entry" && !selectedSlug}
      autoFocusButton="cancel"
      UNSAFE_style={wideDialogStyle}
      onPrimaryAction={() => props.onDelete(redirect)}
    >
      <Flex direction="column" gap="large">
        <Text>{stringFormatter.format("deleteEntryConfirmBody")}</Text>
        {props.itemUrl && (
          <RadioGroup
            label={stringFormatter.format("afterDeletingLabel")}
            value={target}
            onChange={(value) => setTarget(value as typeof target)}
          >
            <Radio value="none">{stringFormatter.format("return404Radio")}</Radio>
            {props.parentUrl && (
              <Radio value="parent">
                <Text>
                  {stringFormatter.format("redirectToListingPagePrefix")}
                  <Text elementType="span" UNSAFE_className={codeText}>
                    {props.parentUrl}
                  </Text>
                  )
                </Text>
              </Radio>
            )}
            <Radio value="entry">
              {stringFormatter.format("redirectToAnotherEntryRadio")}
            </Radio>
          </RadioGroup>
        )}
        {props.itemUrl && target === "entry" && (
          <Combobox
            aria-label={stringFormatter.format("targetEntryLabel")}
            defaultItems={props.otherSlugs.map((slug) => ({ slug }))}
            selectedKey={selectedSlug}
            onSelectionChange={(key) =>
              setSelectedSlug(typeof key === "string" ? key : null)
            }
            menuTrigger="focus"
          >
            {(item) => (
              <Item key={item.slug} textValue={item.slug}>
                <Text>{item.slug}</Text>
              </Item>
            )}
          </Combobox>
        )}
      </Flex>
    </AlertDialog>
  );
}

export function CreateBranchDuringUpdateDialog(props: {
  branchOid: string;
  onCreate: (branchName: string) => void;
  onDismiss: () => void;
  reason: string;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const repoInfo = useRepoInfo();
  const [branchName, setBranchName] = useState("");
  const [{ error, fetching, data }, createBranch] = useCreateBranchMutation();
  const isLoading = fetching || !!data?.createRef?.__typename;

  const config = useConfig();
  const branchPrefix = getBranchPrefix(config);
  const propsForBranchPrefix = branchPrefix
    ? {
        UNSAFE_className: css({
          "& input": {
            paddingInlineStart: tokenSchema.size.space.xsmall,
          },
        }),
        startElement: (
          <Flex
            alignItems="center"
            paddingStart="regular"
            justifyContent="center"
            pointerEvents="none"
          >
            <Text color="neutralSecondary">{branchPrefix}</Text>
          </Flex>
        ),
      }
    : {};

  return (
    <Dialog>
      <form
        style={{ display: "contents" }}
        onSubmit={async (event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          const fullBranchName = (branchPrefix ?? "") + branchName;
          const name = `refs/heads/${fullBranchName}`;
          const result = await createBranch({
            input: { name, oid: props.branchOid, repositoryId: repoInfo!.id },
          });
          if (result.data?.createRef?.__typename) {
            props.onCreate(fullBranchName);
          }
        }}
      >
        <Heading>{stringFormatter.format("newBranch")}</Heading>
        <Content>
          <Flex gap="large" direction="column">
            <TextField
              value={branchName}
              onChange={setBranchName}
              label={stringFormatter.format("branchNameLabel")}
              description={props.reason}
              autoFocus
              errorMessage={prettyErrorForCreateBranchMutation(error, stringFormatter)}
              {...propsForBranchPrefix}
            />
          </Flex>
        </Content>
        <ButtonGroup>
          <Button isDisabled={isLoading} onPress={props.onDismiss}>
            {stringFormatter.format("cancel")}
          </Button>
          <Button isPending={isLoading} prominence="high" type="submit">
            {stringFormatter.format("createBranchAndSave")}
          </Button>
        </ButtonGroup>
      </form>
    </Dialog>
  );
}

type ItemPageWrapperProps = {
  collection: string;
  itemSlug: string;
  config: Config;
  basePath: string;
};

function ItemPageOuterWrapper(props: ItemPageWrapperProps) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const collectionConfig = props.config.collections?.[props.collection];
  if (!collectionConfig) notFound();
  const format = useMemo(
    () => getCollectionFormat(props.config, props.collection),
    [props.config, props.collection],
  );

  const slugInfo = useMemo(() => {
    return { slug: props.itemSlug, field: collectionConfig.slugField };
  }, [collectionConfig.slugField, props.itemSlug]);

  const itemBasePath = getCollectionItemPath(
    props.config,
    props.collection,
    props.itemSlug,
  );
  // bumped after a successful "reset entry data" write so the ErrorBoundary
  // below clears its caught error and re-mounts its children, giving
  // useItemData a chance to load the now-valid data it just wrote
  const [resetNonce, setResetNonce] = useState(0);

  const draftData = useData(
    useCallback(async () => {
      try {
        const raw = await getDraft([
          "collection",
          props.collection,
          props.itemSlug,
        ]);
        if (!raw) throw new Error("No draft found");
        const stored = storedValSchema.create(raw);
        const parsed = parseEntry(
          {
            dirpath: getCollectionItemPath(
              props.config,
              props.collection,
              stored.slug,
            ),
            format: getCollectionFormat(props.config, props.collection),
            schema: collectionConfig.schema,
            slug: { field: collectionConfig.slugField, slug: stored.slug },
          },
          stored.files,
        );
        return {
          state: parsed.initialState,
          savedAt: stored.savedAt,
          treeKey: stored.beforeTreeKey,
        };
      } catch {}
    }, [collectionConfig, props.collection, props.config, props.itemSlug]),
  );

  const itemData = useItemData({
    config: props.config,
    dirpath: itemBasePath,
    schema: collectionConfig.schema,
    format,
    slug: slugInfo,
  });

  return (
    <NotFoundBoundary
      fallback={
        <ItemPageShell {...props}>
          <PageBody>
            <Notice tone="caution">{stringFormatter.format("entryNotFound")}</Notice>
          </PageBody>
        </ItemPageShell>
      }
    >
      <ErrorBoundary
        resetKeys={[resetNonce]}
        fallback={(message) => (
          <ItemPageShell {...props}>
            <PageBody>
              <Flex direction="column" gap="large" alignItems="start">
                <Notice tone="critical">{message}</Notice>
                <ResetEntryDataButton
                  config={props.config}
                  schema={collectionConfig.schema}
                  basePath={itemBasePath}
                  format={format}
                  slug={
                    collectionConfig.slugField
                      ? {
                          field: collectionConfig.slugField,
                          value: props.itemSlug,
                        }
                      : undefined
                  }
                  onReset={() => setResetNonce((n) => n + 1)}
                />
              </Flex>
            </PageBody>
          </ItemPageShell>
        )}
      >
        <Suspense
          fallback={
            <ItemPageShell {...props}>
              <Flex
                alignItems="center"
                justifyContent="center"
                minHeight="scale.3000"
              >
                <ProgressCircle
                  aria-label={stringFormatter.format("loadingItem")}
                  isIndeterminate
                  size="large"
                />
              </Flex>
            </ItemPageShell>
          }
        >
          <ItemPageWrapper
            draftData={draftData}
            itemData={itemData}
            {...props}
          />
        </Suspense>
      </ErrorBoundary>
    </NotFoundBoundary>
  );
}

function ItemPageWrapper(
  props: ItemPageWrapperProps & {
    draftData: DataState<
      { state: any; savedAt: Date; treeKey: string } | undefined
    >;
    itemData: DataState<
      | "not-found"
      | {
          initialState: Record<string, unknown>;
          initialFiles: string[];
          localTreeKey: string;
        }
    >;
  },
) {
  const deferredDraftData = useDeferredValue(props.draftData);
  const itemData = suspendOnData(props.itemData);
  if (itemData === "not-found") notFound();

  const loadedDraft = suspendOnData(deferredDraftData);
  return (
    <LocalItemPage
      collection={props.collection}
      basePath={props.basePath}
      config={props.config}
      itemSlug={props.itemSlug}
      initialState={itemData.initialState}
      initialFiles={itemData.initialFiles}
      draft={loadedDraft}
      localTreeKey={itemData.localTreeKey}
    />
  );
}

function ItemPageShell(
  props: ItemPageWrapperProps & {
    children: ReactNode;
    headerActions?: ReactNode;
  },
) {
  const collectionConfig = getCollection(props.config, props.collection);
  const collectionHref = `${props.basePath}/collection/${props.collection}`;
  const breadcrumbItems = [
    {
      key: "collection",
      label: collectionConfig.label,
      href: collectionHref,
    },
    { key: "item", label: props.itemSlug },
  ];

  return (
    <PageRoot containerWidth={containerWidthForEntryLayout(collectionConfig)}>
      <PageHeader>
        <HeaderBreadcrumbs items={breadcrumbItems} />
        {props.headerActions}
      </PageHeader>

      {props.children}
    </PageRoot>
  );
}

export { ItemPageOuterWrapper as ItemPage };
