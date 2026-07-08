import { ReactNode, useState, useEffect } from "react";
import { ActionButton, Button } from "@keystar/ui/button";
import { AlertDialog, DialogContainer } from "@keystar/ui/dialog";
import { FileTrigger } from "@keystar/ui/drag-and-drop";
import { Icon } from "@keystar/ui/icon";
import { fileUpIcon } from "@keystar/ui/icon/icons/fileUpIcon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { columnsIcon } from "@keystar/ui/icon/icons/columnsIcon";
import { listIcon } from "@keystar/ui/icon/icons/listIcon";
import { Flex } from "@keystar/ui/layout";
import { SearchField } from "@keystar/ui/search-field";
import { Item, TabList, TabPanels, Tabs } from "@keystar/ui/tabs";
import { Text } from "@keystar/ui/typography";

import { useConfig } from "../shell/context";
import {
  useBaseCommit,
  useRepoInfo,
  useSetTreeSha,
  useTree,
} from "../shell/data";
import { useRouter } from "../router";
import { fetchBlob } from "../useItemData";
import { getTreeNodeAtPath, treeSha } from "../trees";
import { getCollectionItemPath, getSingletonPath } from "../path-utils";
import { getEntriesInCollectionWithTreeKey } from "../utils";
import {
  MediaLibraryLocalScope,
  MediaLibraryPick,
} from "../media-library/bridge";

import { MEDIA_LIBRARY_DIRECTORY, TRASH_DIRECTORY } from "./constants";
import { isImagePath } from "./file-kind";
import { AssetGrid, AssetGridItem } from "./AssetGrid";
import { AssetList, AssetListItemData } from "./AssetList";
import { FileManagerBreadcrumbs } from "./FileManagerBreadcrumbs";
import { useDirectoryChildren } from "./useDirectoryChildren";
import { useSearchResults } from "./useSearch";
import { useFileManagerUpload } from "./useFileManagerUpload";
import { UploadConflictDialog } from "./UploadConflictDialog";
import { AssetPreviewOverlay } from "./AssetPreviewOverlay";
import { descendantBlobPaths, useTrash } from "./useTrash";

export type FileManagerMode =
  | {
      kind: "picker";
      accept: "image" | "any";
      selection: "single" | "multi";
      local: MediaLibraryLocalScope | undefined;
      onPick: (picks: MediaLibraryPick[]) => void;
    }
  | { kind: "page" };

function joinDir(root: string, subPath: string) {
  return subPath ? `${root}/${subPath}` : root;
}

type EntriesNav =
  | { step: "root" }
  | { step: "collection"; key: string; label: string }
  | {
      step: "dir";
      rootDir: string;
      subPath: string;
      label: string;
      // where "back" should return to — a collection's entry list, or
      // straight to the Entries root (singletons have no entry list)
      parent:
        | { kind: "root" }
        | { kind: "collection"; key: string; label: string };
    };

// the real directory currently on screen, plus a bytes-fetching helper — used
// by both the "Library"/"Trash" tabs (fixed root) and the "Entries" tab (root
// changes as you drill into a collection/singleton/slug)
function useAssetActions() {
  const config = useConfig();
  const baseCommit = useBaseCommit();
  const repoInfo = useRepoInfo();
  const { basePath } = useRouter();
  const tree = useTree().current;

  async function readBytes(path: string): Promise<Uint8Array | undefined> {
    if (tree.kind !== "loaded") return undefined;
    const sha = getTreeNodeAtPath(tree.data.tree, path)?.entry.sha;
    if (!sha) return undefined;
    return fetchBlob(config, sha, path, baseCommit, repoInfo, basePath);
  }

  return { readBytes, tree };
}

export function FileManagerRoot(props: { mode: FileManagerMode }) {
  const { mode } = props;
  const config = useConfig();
  const setTreeSha = useSetTreeSha();
  const { readBytes, tree } = useAssetActions();
  const { trashPaths, restorePaths, permanentlyDelete } = useTrash();
  const upload = useFileManagerUpload();

  const hasLocalTab = mode.kind === "picker" && !!mode.local;
  const defaultTab = mode.kind === "picker" && mode.local ? "local" : "library";
  const [tab, setTab] = useState<string>(defaultTab);

  const [libraryPath, setLibraryPath] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [trashPath, setTrashPath] = useState("");
  const [entriesNav, setEntriesNav] = useState<EntriesNav>({ step: "root" });
  const [viewMode, setViewModeState] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('file-manager-view-mode');
      if (saved === 'list' || saved === 'grid') {
        setViewModeState(saved);
      }
    } catch (e) {
      // localStorage not available
    }
  }, []);

  const setViewMode = (mode: 'grid' | 'list') => {
    setViewModeState(mode);
    try {
      localStorage.setItem('file-manager-view-mode', mode);
    } catch (e) {
      // localStorage not available
    }
  };

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewSiblings, setPreviewSiblings] = useState<string[]>([]);
  const [previewCanDelete, setPreviewCanDelete] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    kind: "trash" | "permanent" | "restore";
    paths: string[];
    label: string;
  } | null>(null);

  // uploads made in *picker* mode aren't reflected in the shared tree until
  // it naturally refreshes (see useMediaLibraryUpload's note) — cache them
  // locally so they show up immediately in this dialog session
  const [sessionUploads, setSessionUploads] = useState<Map<string, Uint8Array>>(
    new Map(),
  );

  const localRoot = mode.kind === "picker" ? mode.local?.directory : undefined;

  let currentDir: string | null = null;
  if (tab === "local" && localRoot) currentDir = joinDir(localRoot, localPath);
  else if (tab === "library")
    currentDir = joinDir(MEDIA_LIBRARY_DIRECTORY, libraryPath);
  else if (tab === "trash") currentDir = joinDir(TRASH_DIRECTORY, trashPath);
  else if (tab === "entries" && entriesNav.step === "dir") {
    currentDir = joinDir(entriesNav.rootDir, entriesNav.subPath);
  }

  // only used to detect upload conflicts against whichever tab is active —
  // NOT used for rendering a grid (each `renderRealDirectory` call computes
  // its own directory listing scoped to its own root, see below; sharing one
  // "active tab" listing across every tab's grid meant an inactive tab could
  // render stale/wrong-root content, e.g. the whole repo root while browsing
  // the Entries tab's collection picker, where `currentDir` is null)
  const activeDirChildren = useDirectoryChildren(currentDir ?? "");

  const isSelectableFile = (path: string) =>
    mode.kind === "page" || mode.accept !== "image" || isImagePath(path);

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function resolvePicks(paths: string[]): Promise<MediaLibraryPick[]> {
    const source = tab === "library" ? "library" : "local";
    const picks: MediaLibraryPick[] = [];
    for (const path of paths) {
      const content = sessionUploads.get(path) ?? (await readBytes(path));
      if (!content) continue;
      picks.push({
        path: `/${path}`,
        filename: path.split("/").pop()!,
        content,
        source,
      });
    }
    return picks;
  }

  async function pickSingle(path: string) {
    const picks = await resolvePicks([path]);
    if (mode.kind === "picker" && picks.length) mode.onPick(picks);
  }

  async function pickSelected() {
    const picks = await resolvePicks([...selected]);
    if (mode.kind === "picker" && picks.length) mode.onPick(picks);
  }

  async function afterMutation(result: Awaited<ReturnType<typeof trashPaths>>) {
    if (mode.kind === "page" && result) {
      setTreeSha(await treeSha(result.tree));
    }
  }

  async function handleUpload(files: FileList | File[]) {
    if (!currentDir) return;
    const dir = currentDir;
    const existing = new Set([
      ...activeDirChildren.map((c) => c.path),
      ...[...sessionUploads.keys()].filter(
        (p) =>
          p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"),
      ),
    ]);
    const fileArray = Array.from(files);
    const result = await upload.startUpload(fileArray, dir, existing);
    if (mode.kind === "page") {
      await afterMutation(result);
      return;
    }
    // picker mode: only cache eagerly when nothing conflicted (`result`
    // defined means it committed immediately at the exact `${dir}/${name}`
    // path); if a conflict dialog opened instead, the final path depends on
    // what the user picks and the tree will catch up on its own next refresh
    if (result) {
      for (const file of fileArray) {
        const content = new Uint8Array(await file.arrayBuffer());
        setSessionUploads((prev) => {
          const next = new Map(prev);
          next.set(`${dir}/${file.name}`, content);
          return next;
        });
      }
    }
  }

  function requestDelete(paths: string[], label: string) {
    setConfirmAction({ kind: "trash", paths, label });
  }
  function requestPermanentDelete(paths: string[], label: string) {
    setConfirmAction({ kind: "permanent", paths, label });
  }
  function requestRestore(paths: string[], label: string) {
    setConfirmAction({ kind: "restore", paths, label });
  }

  function expandFolders(paths: string[]): string[] {
    if (tree.kind !== "loaded") return paths;
    return paths.flatMap((path) => {
      const node = getTreeNodeAtPath(tree.data.tree, path);
      if (node?.entry.type === "tree") {
        return descendantBlobPaths(tree.data.entries, path).map((e) => e.path);
      }
      return [path];
    });
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    const { kind, paths } = confirmAction;
    setConfirmAction(null);
    if (kind === "permanent") {
      const result = await permanentlyDelete(paths);
      await afterMutation(result);
    } else if (kind === "trash") {
      const result = await trashPaths(expandFolders(paths));
      await afterMutation(result);
      if (previewPath && paths.includes(previewPath)) setPreviewPath(null);
    } else {
      const result = await restorePaths(expandFolders(paths));
      await afterMutation(result);
    }
    setSelected(new Set());
  }

  function crumbsFor(
    rootLabel: string,
    subPath: string,
    onRoot: () => void,
    onSub: (p: string) => void,
  ) {
    const segments = subPath ? subPath.split("/") : [];
    return [
      { key: "", label: rootLabel },
      ...segments.map((seg, i) => ({
        key: segments.slice(0, i + 1).join("/"),
        label: seg,
      })),
    ].map((c, i) => ({
      ...c,
      onNavigate: i === 0 ? onRoot : () => onSub(c.key),
    }));
  }

  function renderRealDirectory(options: {
    rootDir: string;
    rootLabel: string;
    subPath: string;
    setSubPath: (p: string) => void;
    canDelete: boolean;
    canRestore: boolean;
    // ancestor crumbs (e.g. "Entries > My Collection") shown before this
    // directory's own root — lets a nested view like a collection entry's
    // assets folder navigate back up past its own root
    extraCrumbs?: { key: string; label: string; onNavigate: () => void }[];
  }) {
    // scoped to *this* tab's own root — deliberately not the shared
    // `currentDir`/`activeDirChildren` above, which only reflect whichever
    // tab is active. Every applicable tab's content is computed on every
    // render (see `tabs` below), so each call needs its own directory.
    const dir = joinDir(options.rootDir, options.subPath);
    const dirChildren = useDirectoryChildren(dir);
    const searchResults = useSearchResults(options.rootDir, search);

    // freshly-uploaded files in picker mode aren't in the tree yet (see
    // `sessionUploads`) — merge them into the current directory's listing so
    // they show up immediately, same as `dirChildren` would once caught up
    const sessionRows = !searchResults
      ? [...sessionUploads.keys()]
          .filter(
            (p) =>
              p.startsWith(`${dir}/`) &&
              !p.slice(dir.length + 1).includes("/") &&
              !dirChildren.some((c) => c.path === p),
          )
          .map((p) => ({
            path: p,
            type: "blob" as const,
            name: p.split("/").pop()!,
            size: sessionUploads.get(p)?.byteLength,
          }))
      : [];

    const rows: {
      path: string;
      name: string;
      type: "blob" | "tree";
      childCount?: number;
      size?: number;
    }[] = searchResults
      ? searchResults.map((e) => ({
          path: e.path,
          type: "blob" as const,
          name: e.path.split("/").pop()!,
          size: e.size,
        }))
      : [...dirChildren, ...sessionRows];

    const imagePaths = rows
      .filter((r) => r.type === "blob" && isImagePath(r.path))
      .map((r) => r.path);

    const items: AssetGridItem[] = rows.map((child) => {
      const disabled = child.type === "blob" && !isSelectableFile(child.path);
      const isFolder = child.type === "tree";
      return {
        key: child.path,
        name: child.name,
        kind: isFolder ? "folder" : "file",
        path: child.path,
        isImage: !isFolder && isImagePath(child.path),
        childCount: child.childCount,
        size: child.size,
        disabled,
        selectable:
          !disabled &&
          (mode.kind === "page"
            ? true
            : mode.kind === "picker" && mode.selection === "multi"),
        isSelected: selected.has(child.path),
        onToggleSelect: () => toggleSelect(child.path),
        onDelete: options.canDelete
          ? () => requestDelete([child.path], child.name)
          : undefined,
        onRestore: options.canRestore
          ? () => requestRestore([child.path], child.name)
          : undefined,
        onOpen: () => {
          if (disabled) return;
          if (isFolder) {
            options.setSubPath(
              options.subPath ? `${options.subPath}/${child.name}` : child.name,
            );
            return;
          }
          if (mode.kind === "page") {
            setPreviewPath(child.path);
            setPreviewSiblings(
              isImagePath(child.path) ? imagePaths : [child.path],
            );
            setPreviewCanDelete(options.canDelete);
          } else if (mode.selection === "multi") {
            toggleSelect(child.path);
          } else {
            pickSingle(child.path);
          }
        },
      };
    });

    const crumbs = [
      ...(options.extraCrumbs ?? []),
      ...crumbsFor(
        options.rootLabel,
        options.subPath,
        () => options.setSubPath(""),
        (p) => options.setSubPath(p),
      ),
    ];

    return (
      <Flex direction="column" gap="large">
        <FileManagerBreadcrumbs
          crumbs={crumbs.map((c) => ({ key: c.key, label: c.label }))}
          onNavigate={(key) => {
            const crumb = crumbs.find((c) => c.key === key);
            crumb?.onNavigate();
          }}
        />
        {viewMode === 'grid' ? (
          <AssetGrid items={items} />
        ) : (
          <AssetList items={items as AssetListItemData[]} />
        )}
      </Flex>
    );
  }

  function entriesBackCrumbs(
    parent:
      | { kind: "root" }
      | { kind: "collection"; key: string; label: string },
  ) {
    const crumbs = [
      {
        key: "entries",
        label: "Entries",
        onNavigate: () => setEntriesNav({ step: "root" }),
      },
    ];
    if (parent.kind === "collection") {
      crumbs.push({
        key: "collection",
        label: parent.label,
        onNavigate: () =>
          setEntriesNav({
            step: "collection",
            key: parent.key,
            label: parent.label,
          }),
      });
    }
    return crumbs;
  }

  function renderEntriesTab() {
    // called unconditionally, every render, regardless of `entriesNav.step`
    // — `renderRealDirectory` calls hooks internally, and React requires the
    // same hooks to run in the same order on every render of this component
    // instance. `entriesNav.step` is state that changes over that lifetime,
    // so branching around this call (only invoking it for the 'dir' step)
    // would change the hook count between renders. Its output is simply
    // unused for the 'root'/'collection' steps.
    const dirContent = renderRealDirectory({
      rootDir: entriesNav.step === "dir" ? entriesNav.rootDir : "",
      rootLabel: entriesNav.step === "dir" ? entriesNav.label : "",
      subPath: entriesNav.step === "dir" ? entriesNav.subPath : "",
      setSubPath: (p) => {
        if (entriesNav.step === "dir") {
          setEntriesNav({ ...entriesNav, subPath: p });
        }
      },
      canDelete: true,
      canRestore: false,
      extraCrumbs:
        entriesNav.step === "dir"
          ? entriesBackCrumbs(entriesNav.parent)
          : undefined,
    });

    if (entriesNav.step === "root") {
      const collectionKeys = Object.keys(config.collections ?? {});
      const singletonKeys = Object.keys(config.singletons ?? {});
      const items: AssetGridItem[] = [
        ...collectionKeys.map(
          (key): AssetGridItem => ({
            key: `collection:${key}`,
            name: config.collections![key].label,
            kind: "folder",
            onOpen: () =>
              setEntriesNav({
                step: "collection",
                key,
                label: config.collections![key].label,
              }),
          }),
        ),
        ...singletonKeys.map(
          (key): AssetGridItem => ({
            key: `singleton:${key}`,
            name: config.singletons![key].label,
            kind: "folder",
            onOpen: () =>
              setEntriesNav({
                step: "dir",
                rootDir: `${getSingletonPath(config, key)}/assets`,
                subPath: "",
                label: config.singletons![key].label,
                parent: { kind: "root" },
              }),
          }),
        ),
      ];
      return (
        <Flex direction="column" gap="large">
          <FileManagerBreadcrumbs
            crumbs={[{ key: "entries", label: "Entries" }]}
            onNavigate={() => {}}
          />
          {viewMode === 'grid' ? (
            <AssetGrid
              items={items}
              emptyMessage="No collections or singletons configured."
            />
          ) : (
            <AssetList
              items={items as AssetListItemData[]}
              emptyMessage="No collections or singletons configured."
            />
          )}
        </Flex>
      );
    }
    if (entriesNav.step === "collection") {
      const slugEntries =
        tree.kind === "loaded"
          ? getEntriesInCollectionWithTreeKey(
              config,
              entriesNav.key,
              tree.data.tree,
            )
          : [];
      const items: AssetGridItem[] = slugEntries.map((entry) => ({
        key: entry.slug,
        name: entry.slug,
        kind: "folder",
        onOpen: () =>
          setEntriesNav({
            step: "dir",
            rootDir: `${getCollectionItemPath(config, entriesNav.key, entry.slug)}/assets`,
            subPath: "",
            label: entry.slug,
            parent: {
              kind: "collection",
              key: entriesNav.key,
              label: entriesNav.label,
            },
          }),
      }));
      return (
        <Flex direction="column" gap="large">
          <FileManagerBreadcrumbs
            crumbs={[
              { key: "root", label: "Entries" },
              { key: "collection", label: entriesNav.label },
            ]}
            onNavigate={(key) => {
              if (key === "root") setEntriesNav({ step: "root" });
            }}
          />
          {viewMode === 'grid' ? (
            <AssetGrid items={items} emptyMessage="No entries yet." />
          ) : (
            <AssetList items={items as AssetListItemData[]} emptyMessage="No entries yet." />
          )}
        </Flex>
      );
    }
    // step === 'dir'
    return dirContent;
  }

  const canUpload = currentDir !== null && tab !== "trash";

  // built as a plain array (rather than conditionally including <Item>
  // elements with `&&`) so every Item is unconditional — react-stately's
  // collection components reject `false` as a child
  const tabs: { key: string; label: string; content: ReactNode }[] = [];
  if (hasLocalTab) {
    tabs.push({
      key: "local",
      label: mode.kind === "picker" ? mode.local!.label : "",
      content: renderRealDirectory({
        rootDir: localRoot ?? "",
        rootLabel: mode.kind === "picker" ? mode.local!.label : "",
        subPath: localPath,
        setSubPath: setLocalPath,
        // the "local" tab only ever renders in picker mode (see
        // `hasLocalTab`), which never offers delete/restore
        canDelete: false,
        canRestore: false,
      }),
    });
  }
  tabs.push({
    key: "library",
    label: "Library",
    content: renderRealDirectory({
      rootDir: MEDIA_LIBRARY_DIRECTORY,
      rootLabel: "Library",
      subPath: libraryPath,
      setSubPath: setLibraryPath,
      canDelete: mode.kind === "page",
      canRestore: false,
    }),
  });
  if (mode.kind === "page") {
    tabs.push({
      key: "entries",
      label: "Entries",
      content: renderEntriesTab(),
    });
    tabs.push({
      key: "trash",
      label: "Trash",
      content: renderRealDirectory({
        rootDir: TRASH_DIRECTORY,
        rootLabel: "Trash",
        subPath: trashPath,
        setSubPath: setTrashPath,
        canDelete: false,
        canRestore: true,
      }),
    });
  }

  return (
    <Flex direction="column" gap="large">
      <Tabs
        aria-label="File manager"
        selectedKey={tab}
        onSelectionChange={(key) => {
          setTab(String(key));
          setSelected(new Set());
          setSearch("");
        }}
      >
        <Flex alignItems="center" justifyContent="space-between" gap="regular">
          <TabList>
            {tabs.map((t) => (
              <Item key={t.key}>{t.label}</Item>
            ))}
          </TabList>
          <Flex alignItems="center" gap="regular" wrap>
            {selected.size > 0 && (
              <>
                <Text size="small">{selected.size} selected</Text>
                {tab === "trash" ? (
                  <>
                    <Button
                      onPress={() =>
                        requestRestore([...selected], `${selected.size} items`)
                      }
                    >
                      Restore
                    </Button>
                    <Button
                      tone="critical"
                      onPress={() =>
                        requestPermanentDelete(
                          [...selected],
                          `${selected.size} items`,
                        )
                      }
                    >
                      Delete forever
                    </Button>
                  </>
                ) : mode.kind === "page" ? (
                  <Button
                    tone="critical"
                    onPress={() =>
                      requestDelete([...selected], `${selected.size} items`)
                    }
                  >
                    <Icon src={trash2Icon} />
                    <Text>Delete</Text>
                  </Button>
                ) : (
                  <Button prominence="high" onPress={pickSelected}>
                    Use {selected.size} file{selected.size === 1 ? "" : "s"}
                  </Button>
                )}
              </>
            )}
            {canUpload && (
              <FileTrigger
                allowsMultiple
                acceptedFileTypes={
                  mode.kind === "picker" && mode.accept === "image"
                    ? ["image/*"]
                    : undefined
                }
                onSelect={(files) => {
                  if (files) handleUpload(files);
                }}
              >
                <ActionButton isDisabled={upload.isUploading}>
                  <Icon src={fileUpIcon} />
                  <Text>{upload.isUploading ? "Uploading…" : "Upload"}</Text>
                </ActionButton>
              </FileTrigger>
            )}
            <SearchField
              aria-label="Search files"
              placeholder="Search by name…"
              value={search}
              onChange={setSearch}
              width="scale.2400"
            />
            <Flex gap="small">
              <ActionButton
                isSelected={viewMode === 'grid'}
                aria-label="Grid view"
                onPress={() => setViewMode('grid')}
              >
                <Icon src={columnsIcon} />
              </ActionButton>
              <ActionButton
                isSelected={viewMode === 'list'}
                aria-label="List view"
                onPress={() => setViewMode('list')}
              >
                <Icon src={listIcon} />
              </ActionButton>
            </Flex>
          </Flex>
        </Flex>
        <TabPanels>
          {tabs.map((t) => (
            <Item key={t.key}>{t.content}</Item>
          ))}
        </TabPanels>
      </Tabs>

      <DialogContainer onDismiss={upload.abortUpload}>
        {upload.pendingConflict && (
          <UploadConflictDialog
            state={upload.pendingConflict}
            onResolve={async (resolution, applyToAll) => {
              const result = await upload.resolveCurrent(
                resolution,
                applyToAll,
              );
              if (mode.kind === "page") await afterMutation(result);
            }}
          />
        )}
      </DialogContainer>

      {previewPath && (
        <AssetPreviewOverlay
          path={previewPath}
          siblings={previewSiblings}
          onNavigate={setPreviewPath}
          onDelete={
            previewCanDelete
              ? () =>
                  requestDelete([previewPath], previewPath.split("/").pop()!)
              : undefined
          }
          onClose={() => setPreviewPath(null)}
        />
      )}

      <DialogContainer onDismiss={() => setConfirmAction(null)}>
        {confirmAction && (
          <AlertDialog
            title={
              confirmAction.kind === "restore"
                ? "Restore files?"
                : "Delete files?"
            }
            tone={confirmAction.kind === "restore" ? "neutral" : "critical"}
            primaryActionLabel={
              confirmAction.kind === "restore"
                ? "Restore"
                : confirmAction.kind === "permanent"
                  ? "Delete forever"
                  : "Move to trash"
            }
            cancelLabel="Cancel"
            onCancel={() => setConfirmAction(null)}
            onPrimaryAction={runConfirmedAction}
          >
            {confirmAction.kind === "restore"
              ? `Restore ${confirmAction.label}?`
              : confirmAction.kind === "permanent"
                ? `Permanently delete ${confirmAction.label}? This can't be undone.`
                : `Move ${confirmAction.label} to trash? You can restore it later from the Trash tab.`}
          </AlertDialog>
        )}
      </DialogContainer>
    </Flex>
  );
}
