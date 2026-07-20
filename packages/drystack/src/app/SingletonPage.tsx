import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "./l10n";
import { useRouter } from "./router";
import { useScrollToFieldParam } from "./useScrollToFieldParam";
import {
  FormEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@keystar/ui/badge";
import { Button } from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { Flex } from "@keystar/ui/layout";
import { Notice } from "@keystar/ui/notice";
import { ProgressCircle } from "@keystar/ui/progress";
import { Heading, Text } from "@keystar/ui/typography";

import { Config } from "../config";
import { clientSideValidateProp } from "../form/errors";
import { getInitialPropsValue } from "../form/initial-values";
import { useEventCallback } from "../form/fields/use-event-callback";
import {
  getDataFileExtension,
  getPathPrefix,
  getRepoUrl,
  getSingletonFormat,
  getSingletonPath,
  isGitHubConfig,
  useShowRestoredDraftMessage,
} from "./utils";

import { CreateBranchDuringUpdateDialog } from "./ItemPage";
import { PageBody, PageHeader, PageRoot } from "./shell/page";
import { useBaseCommit, useCurrentBranch, useRepoInfo } from "./shell/data";
import { useConfig } from "./shell/context";
import { AiLockProvider } from "./ai/lock-context";
import { MagicWriteButton, useAiEntryDescription } from "./ai/MagicWriteButton";
import { useMagicWrite } from "./ai/useMagicWrite";
import { useHasChanged } from "./useHasChanged";
import {
  ChangePreviewDialog,
  type FieldChange,
} from "./change-preview/ChangePreviewDialog";
import { computeFieldChanges } from "./change-preview/computeFieldChanges";
import { AdminImageThumb } from "./change-preview/AdminImageThumb";
import { parseEntry, useItemData } from "./useItemData";
import { serializeEntryToFiles, useUpsertItem } from "./updating";
import { ResetEntryDataButton } from "./reset-entry-data";
import { Icon } from "@keystar/ui/icon";
import { ForkRepoDialog } from "./fork-repo";
import {
  EntryDirectoryProvider,
  FormForEntry,
  containerWidthForEntryLayout,
} from "./entry-form";
import { notFound } from "./not-found";
import { delDraft, getDraft, setDraft } from "./persistence";
import { useEntryEditSync } from "./useEntryEditSync";
import type { EntryRef } from "./path-utils";
import * as s from "superstruct";
import { useData } from "./useData";
import { ActionGroup, Item } from "@keystar/ui/action-group";
import { useMediaQuery, breakpointQueries } from "@keystar/ui/style";
import { githubIcon } from "@keystar/ui/icon/icons/githubIcon";
import { externalLinkIcon } from "@keystar/ui/icon/icons/externalLinkIcon";
import { usePreviewProps, useSingleton } from "./preview-props";
import { ComponentSchema, GenericPreviewProps } from "..";
import { copyEntryToClipboard, getPastedEntry } from "./entry-clipboard";
import { clipboardPasteIcon } from "@keystar/ui/icon/icons/clipboardPasteIcon";
import { clipboardCopyIcon } from "@keystar/ui/icon/icons/clipboardCopyIcon";
import { setValueToPreviewProps } from "../form/get-value";
import { toastQueue } from "@keystar/ui/toast";

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
    magicWrite: ReturnType<typeof useMagicWrite>;
  },
) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const isBelowDesktop = useMediaQuery(breakpointQueries.below.desktop);
  const repoInfo = useRepoInfo();
  const currentBranch = useCurrentBranch();
  const [forceValidation, setForceValidation] = useState(false);

  const { schema, singletonConfig } = useSingleton(props.singleton);
  const aiEntryDescription = useAiEntryDescription(
    useConfig(),
    props.singleton,
  );
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const router = useRouter();
  useScrollToFieldParam();

  const previewHref = useMemo(() => {
    if (!singletonConfig.previewUrl) return undefined;
    return singletonConfig.previewUrl.replace("{branch}", currentBranch);
  }, [currentBranch, singletonConfig.previewUrl]);
  const isGitHub = isGitHubConfig(props.config);
  const formatInfo = getSingletonFormat(props.config, props.singleton);
  const singletonExists = !!props.initialState;
  const singletonPath = getSingletonPath(props.config, props.singleton);

  const viewHref =
    isGitHub && singletonExists && repoInfo
      ? `${getRepoUrl(repoInfo)}${
          formatInfo.dataLocation === "index"
            ? `/tree/${currentBranch}/${
                getPathPrefix(props.config.storage) ?? ""
              }${singletonPath}`
            : `/blob/${
                getPathPrefix(props.config.storage) ?? ""
              }${currentBranch}/${singletonPath}${getDataFileExtension(
                formatInfo,
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
        key: "copy",
        label: stringFormatter.format("copyEntry"),
        icon: clipboardCopyIcon,
      },
      {
        key: "paste",
        label: stringFormatter.format("pasteEntry"),
        icon: clipboardPasteIcon,
      },
    ];
    if (previewHref) {
      actions.push({
        key: "preview",
        label: stringFormatter.format("preview"),
        icon: externalLinkIcon,
        href: previewHref,
        target: "_blank",
        rel: "noopener noreferrer",
      });
    }
    if (viewHref) {
      actions.push({
        key: "view",
        label: stringFormatter.format("viewOnGithub"),
        icon: githubIcon,
        href: viewHref,
        target: "_blank",
        rel: "noopener noreferrer",
      });
    }
    return actions;
  }, [previewHref, viewHref, stringFormatter]);

  const formID = "singleton-form";

  const baseCommit = useBaseCommit();

  // build tracking now lives on the Deploy button (deploy/DeployButton.tsx):
  // saves commit to the editor's brand branch, which never triggers a
  // Cloudflare build on its own - only merging a brand into the default
  // branch does. See plan/brand.md §11.

  const isCreating = props.initialState === null;

  const onCreate = async () => {
    if (props.updateResult.kind === "loading" || !props.hasChanged) return;
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
      undefined,
    );
  };

  const onPaste = async () => {
    const entry = await getPastedEntry(
      formatInfo,
      singletonConfig.schema,
      undefined,
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
  };

  return (
    <AiLockProvider
      lockedKeys={props.magicWrite.streamingKeys}
      fieldMagicWrite={
        aiEntryDescription
          ? {
              entryLabel: singletonConfig.label,
              schema: singletonConfig.schema,
              state: props.state,
              magicWrite: props.magicWrite,
            }
          : null
      }
    >
      <PageRoot containerWidth={containerWidthForEntryLayout(singletonConfig)}>
        <PageHeader>
          <Flex flex alignItems="center" gap="regular">
            <Heading elementType="h1" id="page-title" size="small">
              {singletonConfig.label}
            </Heading>
            {props.updateResult.kind === "loading" ? (
              <ProgressCircle
                aria-label={stringFormatter.format("updatingEntity", {
                  label: singletonConfig.label,
                })}
                isIndeterminate
                size="small"
                alignSelf="center"
              />
            ) : (
              props.hasChanged && (
                <button
                  type="button"
                  onClick={() => setReviewOpen(true)}
                  aria-label={stringFormatter.format("reviewChanges")}
                  style={{
                    all: "unset",
                    display: "inline-flex",
                    cursor: "pointer",
                  }}
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
            maxWidth={isBelowDesktop ? "element.regular" : undefined} // force switch to action menu on small devices
            items={menuActions}
            onAction={(key) => {
              switch (key) {
                case "copy":
                  onCopy();
                  break;
                case "paste":
                  onPaste();
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
              entryLabel={singletonConfig.label}
              schema={singletonConfig.schema}
              state={props.state}
              magicWrite={props.magicWrite}
            />
          )}
          <Button
            form={formID}
            isPending={props.updateResult.kind === "loading"}
            prominence="high"
            type="submit"
          >
            {isCreating ? "Create" : "Save"}
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
          {props.updateResult.kind === "error" && (
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
            {props.updateResult.kind === "needs-new-branch" && (
              <CreateBranchDuringUpdateDialog
                branchOid={baseCommit}
                onCreate={async (newBranch) => {
                  router.push(
                    `${router.basePath}/branch/${encodeURIComponent(
                      newBranch,
                    )}/singleton/${encodeURIComponent(props.singleton)}`,
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
            {props.updateResult.kind === "needs-fork" &&
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
                onResetAll={props.onReset}
                renderImage={(path: string) => <AdminImageThumb path={path} />}
              />
            )}
          </DialogContainer>
        </Flex>
      </PageRoot>
    </AiLockProvider>
  );
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
  },
) {
  const { singleton, initialFiles, initialState, localTreeKey, config, draft } =
    props;
  const { schema, singletonConfig } = useSingleton(props.singleton);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const singletonPath = getSingletonPath(config, singleton);
  const singletonRef: EntryRef = useMemo(
    () => ({ type: "singleton", name: singleton }),
    [singleton],
  );

  const [{ state, localTreeKey: localTreeKeyInState }, setState] = useState(
    () => ({
      localTreeKey: localTreeKey,
      state:
        draft?.state ??
        (initialState === null ? getInitialPropsValue(schema) : initialState),
    }),
  );

  // Per-field values a *remote* save/reset (another tab, or the visual
  // editor) has already committed to disk - see the subscribeEdits handler
  // below. Merged into `initialState` for the hasChanged/"Unsaved" check so
  // content saved from elsewhere doesn't keep showing as locally unsaved.
  // Reset alongside `state` whenever the tree genuinely reloads (below):
  // the fresh `initialState` prop already carries these values then.
  // Values are whatever the form state holds for that field, content's
  // editor-state object included - this only ever spreads them back over
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
    () =>
      computeFieldChanges(schema, effectiveInitialState, state, stringFormatter),
    [schema, effectiveInitialState, state, stringFormatter],
  );

  useEffect(() => {
    const key = ["singleton", singleton] as const;
    if (hasChanged) {
      const serialized = serializeEntryToFiles({
        basePath: singletonPath,
        format: getSingletonFormat(config, singleton),
        schema: singletonConfig.schema,
        slug: undefined,
        state,
      });
      const files = new Map<string, Uint8Array<ArrayBuffer>>(
        serialized.map((x) => [x.path, x.contents as Uint8Array<ArrayBuffer>]),
      );
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
      setState((state) => ({
        localTreeKey: state.localTreeKey,
        state: cb(state.state),
      }));
    },
    [],
  );

  const magicWriteEntry = useMemo(
    () => ({ kind: "singleton" as const, key: props.singleton }),
    [props.singleton],
  );
  const magicWrite = useMagicWrite({
    entry: magicWriteEntry,
    schema: singletonConfig.schema,
    onStateChange: onPreviewPropsChange,
  });


  const previewProps = usePreviewProps(
    schema,
    onPreviewPropsChange,
    state as Record<string, unknown>,
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
  // pending - see useEntryEditSync's own doc comment for the full mechanics
  // (mount catch-up, debounced publish, live subscribeEdits, and this final
  // "drop now-committed keys" step). Called here (after useUpsertItem) so
  // `updateResult` is available for that last step.
  useEntryEditSync({
    ref: singletonRef,
    schema: singletonConfig.schema,
    entryDir: singletonPath,
    state,
    onPreviewPropsChange,
    initialState,
    committedOverrides,
    setCommittedOverrides,
    updateResult,
  });

  const resetState = useMemo(
    () =>
      effectiveInitialState === null
        ? getInitialPropsValue(schema)
        : effectiveInitialState,
    [effectiveInitialState, schema],
  );
  const onReset = () =>
    setState({ localTreeKey: localTreeKey, state: resetState });
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
      magicWrite={magicWrite}
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
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
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
    [props.config, props.singleton],
  );

  const dirpath = getSingletonPath(props.config, props.singleton);

  const draftData = useData(
    useCallback(async () => {
      const raw = await getDraft(["singleton", props.singleton]);
      if (!raw) throw new Error("No draft found");
      const stored = storedValSchema.create(raw);
      const parsed = parseEntry(
        {
          dirpath,
          format,
          schema: singletonConfig.schema,
          slug: undefined,
        },
        stored.files,
      );
      return {
        state: parsed.initialState,
        savedAt: stored.savedAt,
        treeKey: stored.beforeTreeKey,
      };
    }, [dirpath, format, props.singleton, singletonConfig.schema]),
  );

  const itemData = useItemData({
    config: props.config,
    dirpath,
    schema: singletonConfig.schema,
    format,
    slug: undefined,
  });
  if (itemData.kind === "error") {
    return (
      <PageRoot>
        {header}
        <PageBody>
          <Flex
            direction="column"
            gap="large"
            alignItems="start"
            margin="xxlarge"
          >
            <Notice tone="critical">{itemData.error.message}</Notice>
            <ResetEntryDataButton
              config={props.config}
              schema={singletonConfig.schema}
              basePath={dirpath}
              format={format}
              slug={undefined}
              onReset={() => {}}
            />
          </Flex>
        </PageBody>
      </PageRoot>
    );
  }

  if (itemData.kind === "loading" || draftData.kind === "loading") {
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
              aria-label={stringFormatter.format("loadingEntity", {
                label: singletonConfig.label,
              })}
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
        itemData.data === "not-found" ? null : itemData.data.initialState
      }
      initialFiles={
        itemData.data === "not-found" ? [] : itemData.data.initialFiles
      }
      localTreeKey={
        itemData.data === "not-found" ? undefined : itemData.data.localTreeKey
      }
      draft={draftData.kind === "loaded" ? draftData.data : undefined}
    />
  );
}

export { SingletonPageWrapper as SingletonPage };
