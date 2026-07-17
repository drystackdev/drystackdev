import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { Ref, forwardRef, useId, useMemo, useState } from 'react';
import { Box } from '@keystar/ui/layout';
import { useProseStyleProps } from '@keystar/ui/typography';
import {
  breakpointQueries,
  css,
  toDataAttributes,
  tokenSchema,
} from '@keystar/ui/style';

import { Toolbar } from './Toolbar';
import { prosemirrorStyles } from './utils';
import { EditorPopoverDecoration } from './popovers';
import { getEditorSchema } from './schema';
import { ProseMirrorEditable, ProseMirrorEditor } from './editor-view';
import { AutocompleteDecoration } from './autocomplete/decoration';
import { NodeViews } from './react-node-views';
import {
  EditorContextProvider,
  getContentId,
  getRootId,
  getToolbarId,
} from './context';
import { SelectionRewriteButton } from '../../../../app/ai/SelectionRewriteButton';
import { useEntryLayoutSplitPaneContext } from '../../../../app/entry-form';
import { useContentPanelSize } from '../../../../app/shell/context';
import { yCursorPluginKey, ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';

const contentStyles = css({
  flex: 1,
  height: 'auto',
  minHeight: tokenSchema.size.scale[2000],
  minWidth: 0,
  outline: 0,
  padding: tokenSchema.size.space.medium,

  '[data-layout="main"] > div > &': {
    boxSizing: 'border-box',
    height: '100%',
    padding: 0,
    paddingTop: tokenSchema.size.space.medium,
    minHeight: 0,
    minWidth: 0,
    maxWidth: 800,
    marginInline: 'auto',

    [breakpointQueries.above.mobile]: {
      padding: tokenSchema.size.space.xlarge,
    },
    [breakpointQueries.above.tablet]: {
      padding: tokenSchema.size.space.xxlarge,
    },

    '&[data-container="wide"]': {
      padding: tokenSchema.size.scale[600],
    },
  },
});

// An inline-only field (config.inlineOnly, e.g. a bold-only heading) is a
// single short line, not a document body - reserving the same empty space as
// a full content field would leave a big blank box under it.
const inlineContentStyles = css(contentStyles, { minHeight: 0 });

export const Editor = forwardRef(function Editor(
  {
    value: _value,
    onChange: _onChange,
    ...props
  }: {
    value: EditorState;
    onChange: (state: EditorState) => void;
  },
  ref: Ref<{ view: EditorView | null }>
) {
  const [valueWhileInCollab, setValueWhileInCollab] =
    useState<EditorState>(_value);
  if ('yjs' in _onChange) {
    const yjsFragment: Y.XmlFragment | undefined =
      ySyncPluginKey.getState(valueWhileInCollab)?.type;
    if (yjsFragment !== (_onChange as any).yjs()) {
      setValueWhileInCollab(_value);
    }
  }
  let entryLayoutPane = useEntryLayoutSplitPaneContext();
  const containerSize = useContentPanelSize();
  const inlineOnly = getEditorSchema(_value.schema).config.inlineOnly;
  const styleProps = useProseStyleProps({
    size: entryLayoutPane === 'main' ? 'medium' : 'regular',
    UNSAFE_className: inlineOnly ? inlineContentStyles : contentStyles,
    ...toDataAttributes({ layout: entryLayoutPane, container: containerSize }),
  });
  let value, onChange;
  if (yCursorPluginKey.getState(_value)) {
    value = valueWhileInCollab ?? _value;
    onChange = setValueWhileInCollab;
  } else {
    value = _value;
    onChange = _onChange;
  }

  const id = useId();
  const editorContext = useMemo(() => ({ id }), [id]);
  return (
    <EditorContextProvider value={editorContext}>
      <ProseMirrorEditor value={value} onChange={onChange} ref={ref}>
        <Box
          id={getRootId(id)}
          data-drystack-editor="root"
          data-layout={entryLayoutPane}
          backgroundColor="canvas"
          minWidth={0}
          UNSAFE_className={css(prosemirrorStyles, {
            '&[data-layout="main"]': {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
            },
            '&:not([data-layout="main"])': {
              border: `${tokenSchema.size.border.regular} solid ${tokenSchema.color.border.neutral}`,
              borderRadius: tokenSchema.size.radius.medium,
            },
          })}
        >
          <Toolbar id={getToolbarId(id)} data-drystack-editor="toolbar" />
          <div>
            <ProseMirrorEditable
              {...props}
              {...styleProps}
              role="textbox"
              aria-multiline="true"
              id={getContentId(id)}
              data-drystack-editor="content"
            />
          </div>
        </Box>
        <NodeViews state={value} />
        <EditorPopoverDecoration state={value} />
        <AutocompleteDecoration />
        {/* Renders nothing unless the field is a content field on an
            AI-enabled entry with a passage selected - see the component. */}
        <SelectionRewriteButton />
      </ProseMirrorEditor>
    </EditorContextProvider>
  );
});
