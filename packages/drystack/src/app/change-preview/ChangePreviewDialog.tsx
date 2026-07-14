import { ReactNode, useState } from 'react';
import { ActionButton, Button, ButtonGroup } from '@keystar/ui/button';
import { Dialog, useDialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { Flex } from '@keystar/ui/layout';
import { chevronRightIcon } from '@keystar/ui/icon/icons/chevronRightIcon';
import { trash2Icon } from '@keystar/ui/icon/icons/trash2Icon';
import { Content } from '@keystar/ui/slots';
import { css } from '@keystar/ui/style';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';
import { Heading, Text } from '@keystar/ui/typography';

// Raw markup styling for the accordion — kept as scoped emotion classes
// (rather than a global stylesheet like VEI's old editor.css) so this
// component works unmodified in both the visual editor and the admin, which
// don't share a CSS bundle. The `--kui-*` custom properties are published by
// KeystarProvider at the tree root, present in both hosts.
const accordionItem = css({
  border: '1px solid rgba(128, 128, 128, 0.3)',
  borderRadius: 8,
  overflow: 'hidden',
  '& + &': { marginTop: 8 },
});
const accordionHead = css({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  paddingRight: 6,
});
const accordionSummary = css({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  '&:hover': { background: 'rgba(128, 128, 128, 0.08)' },
});
const accordionChevron = css({
  display: 'flex',
  flex: 'none',
  color: 'var(--kui-color-foreground-neutral, #1f2937)',
  opacity: 0.6,
  transition: 'transform 0.2s ease',
});
const accordionChevronOpen = css({ transform: 'rotate(90deg)' });
// grid-template-rows 0fr <-> 1fr animates the height without a fixed max-height.
const accordionBody = css({
  display: 'grid',
  gridTemplateRows: '0fr',
  transition: 'grid-template-rows 0.25s ease',
});
const accordionBodyOpen = css({ gridTemplateRows: '1fr' });
const accordionBodyInner = css({ overflow: 'hidden', minHeight: 0 });

// Shared by the visual editor (VEI) and the admin — both surface a list of
// pending field-level edits and need to look/behave identically (see
// CLAUDE.md's GitHub-mode-parity rule: this is UI, not a storage path, so
// there's only one implementation to keep in sync, not two).
//
// `key` identifies the field (VEI: the data-dry spot key; admin: the
// top-level schema field name) — only meaningful to the caller, used here
// just to key the list and to call `onDelete`. `label` is always the
// schema-configured field label (both sides fall back to the raw field key
// if unset) — kept identical between VEI and admin so the dialog reads the
// same either way. `sublabel` is optional extra context rendered after the
// label; neither current caller sets it today.
export type FieldChange = {
  key: string;
  label: string;
  sublabel?: string;
  kind: 'text' | 'image';
  before: string;
  after: string;
};

// `changes: null` means still loading (VEI reads its list from IndexedDB
// asynchronously; the admin already has everything in memory and never
// passes null). `onDelete`, when provided, adds a discard action per row —
// both VEI and the admin wire this up: VEI reverts the live DOM spot to its
// original value, the admin reverts just that one top-level field in form
// state (independent of the whole-entry "Reset" action elsewhere).
export function ChangePreviewDialog({
  changes,
  onDelete,
  renderImage,
  title = 'Review changes',
}: {
  changes: FieldChange[] | null;
  onDelete?: (key: string) => void;
  renderImage?: (path: string) => ReactNode;
  title?: string;
}) {
  const { dismiss } = useDialogContainer();

  return (
    <Dialog size="large" aria-label={title}>
      <Heading>{title}</Heading>
      <Content>
        {!changes && <Text>Loading…</Text>}
        {changes?.length === 0 && <Text>No changes.</Text>}
        {changes && changes.length > 0 && (
          <div>
            {changes.map((c, i) => (
              <FieldDiffView
                key={c.key}
                change={c}
                defaultOpen={i === 0}
                onDelete={onDelete}
                renderImage={renderImage}
              />
            ))}
          </div>
        )}
      </Content>
      <ButtonGroup>
        <Button onPress={dismiss}>Close</Button>
      </ButtonGroup>
    </Dialog>
  );
}

function FieldDiffView({
  change,
  defaultOpen,
  onDelete,
  renderImage,
}: {
  change: FieldChange;
  defaultOpen?: boolean;
  onDelete?: (key: string) => void;
  renderImage?: (path: string) => ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const lines = diffLines(change.before, change.after);
  return (
    <div className={accordionItem}>
      <div className={accordionHead}>
        <button
          type="button"
          className={accordionSummary}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span
            className={`${accordionChevron}${open ? ` ${accordionChevronOpen}` : ''}`}
          >
            <Icon src={chevronRightIcon} />
          </span>
          <Text weight="semibold">{change.label}</Text>
          {change.sublabel && (
            <Text color="neutralSecondary">· {change.sublabel}</Text>
          )}
        </button>
        {onDelete && (
          <TooltipTrigger>
            <ActionButton
              prominence="low"
              aria-label="Discard this change"
              onPress={() => onDelete(change.key)}
            >
              <Icon src={trash2Icon} />
            </ActionButton>
            <Tooltip>Discard this change</Tooltip>
          </TooltipTrigger>
        )}
      </div>
      <div className={`${accordionBody}${open ? ` ${accordionBodyOpen}` : ''}`}>
        <div className={accordionBodyInner}>
          {change.kind === 'image' ? (
            <ImageDiffView
              before={change.before}
              after={change.after}
              renderImage={renderImage}
            />
          ) : (
            <div
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.5,
                borderTop: '1px solid rgba(128,128,128,0.3)',
                overflowX: 'auto',
                color: 'var(--kui-color-foreground-neutral, #1f2937)',
              }}
            >
              {lines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    padding: '0 8px',
                    background:
                      line.type === 'add'
                        ? 'rgba(22,163,74,0.16)'
                        : line.type === 'del'
                          ? 'rgba(220,38,38,0.16)'
                          : 'transparent',
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      flex: 'none',
                      userSelect: 'none',
                      color:
                        line.type === 'add'
                          ? '#16a34a'
                          : line.type === 'del'
                            ? '#dc2626'
                            : 'rgba(128,128,128,0.7)',
                    }}
                  >
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                  </span>
                  <span style={{ flex: 1 }}>{line.text || ' '}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The whole before/after image cell — empty state included — exported so
// VeiImageThumb (Toolbar.tsx) and AdminImageThumb each only need to resolve a
// display URL for their own storage (pending-blob cache vs. tree-sha preview
// cache) and hand it here, instead of re-declaring the "no image yet" check
// and its markup on both sides.
export function ImageThumbFrame({ path, src }: { path: string; src: string }) {
  if (!path) {
    return <Text color="neutralSecondary">No image</Text>;
  }
  return (
    <img
      src={src}
      alt=""
      style={{
        display: 'block',
        maxWidth: 140,
        maxHeight: 100,
        borderRadius: 6,
        objectFit: 'contain',
        background: 'rgba(128,128,128,0.08)',
      }}
    />
  );
}

function ImageDiffView({
  before,
  after,
  renderImage,
}: {
  before: string;
  after: string;
  renderImage?: (path: string) => ReactNode;
}) {
  const render = renderImage ?? (path => <ImageThumbFrame path={path} src={path} />);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 12,
        borderTop: '1px solid rgba(128,128,128,0.3)',
      }}
    >
      <Flex direction="column" gap="small">
        <Text size="small" color="neutralSecondary">Before</Text>
        {render(before)}
      </Flex>
      <Icon src={chevronRightIcon} />
      <Flex direction="column" gap="small">
        <Text size="small" color="neutralSecondary">After</Text>
        {render(after)}
      </Flex>
    </div>
  );
}

type DiffLine = { type: 'add' | 'del' | 'same'; text: string };

// Minimal LCS line diff — enough to preview a single field's text change.
function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}
