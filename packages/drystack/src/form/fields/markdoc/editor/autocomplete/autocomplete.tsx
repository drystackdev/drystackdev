import { useMemo } from 'react';

import { EditorPopover } from '@keystar/ui/editor';

import { useEditorViewRef } from '../editor-view';
import { useEditorKeydownListener } from '../keydown';
import { useEditorReferenceElement } from '../popovers/reference';
import { EditorListboxProps, useEditorListbox } from './EditorListbox';

export function EditorAutocomplete<Item extends object>(
  props: Omit<EditorListboxProps<Item>, 'listenerRef'> & {
    from: number;
    to: number;
  }
) {
  const viewRef = useEditorViewRef();
  const referenceElement = useEditorReferenceElement(props.from, props.to);
  const listenerRef = useMemo(() => {
    return {
      get current() {
        return viewRef.current?.dom ?? null;
      },
    };
  }, [viewRef]);
  const { keydownListener, listbox } = useEditorListbox({
    listenerRef,
    ...props,
    UNSAFE_style: { width: 320, ...props.UNSAFE_style },
  });
  useEditorKeydownListener(event => {
    keydownListener(event);
    return event.defaultPrevented;
  });

  return (
    referenceElement && (
      <EditorPopover
        adaptToBoundary="stretch"
        portal={false}
        minWidth="element.medium"
        placement="bottom-start"
        reference={referenceElement}
        // the sticky toolbar sits at zIndex:2 (see Toolbar.tsx's
        // ToolbarWrapper) - typing "/" on the first line or two of content
        // floats this popover right underneath it, and without a higher
        // zIndex of its own it renders behind the toolbar instead of over it
        UNSAFE_style={{ zIndex: 3 }}
      >
        {listbox}
      </EditorPopover>
    )
  );
}
