import { Command, EditorState } from "prosemirror-state";
import { getEditorSchema, EditorSchema } from "./schema";
import React, {
  HTMLAttributes,
  MutableRefObject,
  ReactNode,
  Ref,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useEventCallback } from "./utils";
import { EditorView } from "prosemirror-view";
import { useConfig } from "../../../../app/shell/context";
import { useIsAiLocked } from "../../../../app/ai/lock-context";

const EditorStateContext = React.createContext<EditorState | null>(null);

export function useEditorState() {
  const state = useContext(EditorStateContext);
  if (state === null) {
    throw new Error("useEditorState must be used inside ProseMirrorEditorView");
  }
  return state;
}

export function useEditorDispatchCommand() {
  return useStableEditorContext().dispatchCommand;
}

export function useEditorSchema() {
  return useStableEditorContext().schema;
}

export function useEditorViewRef() {
  return useStableEditorContext().view;
}

export function useEditorViewInEffect() {
  const editorViewRef = useEditorViewRef();
  const state = useEditorState();
  return useCallback(() => {
    if (editorViewRef.current && editorViewRef.current.state !== state) {
      editorViewRef.current?.updateState(state);
    }
    return editorViewRef.current;
  }, [editorViewRef, state]);
}

export function useLayoutEffectWithEditorUpdated(effect: () => void) {
  const editorView = useEditorViewRef();
  const state = useEditorState();

  const update = useEventCallback(() => {
    if (editorView.current && editorView.current.state !== state) {
      editorView.current?.updateState(state);
    }
  });

  useLayoutEffect(() => {
    update();
    return effect();
  }, [update, effect]);
}

/**
 * `externalMount` adopts a DOM node this component didn't render - the live
 * site's own element, in the visual editor's inline `fields.content` spot
 * (see packages/astro/src/editor/InlineContentEditors.tsx). ProseMirror's
 * `{ mount }` option is built for exactly this, so the page's own CSS
 * cascade keeps applying while editing instead of the CMS's typography.
 *
 * Caveat for external mounts: `view.destroy()` empties a mounted node rather
 * than leaving the last-rendered doc in it, so a caller that wants the
 * content to stay visible after unmount must repaint the node itself.
 */
export function useEditorView(
  state: EditorState,
  _onEditorStateChange: (state: EditorState) => void,
  externalMount?: HTMLElement | null,
  isEditable = true,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const config = useConfig();
  const onEditorStateChange = useEventCallback(_onEditorStateChange);
  // ProseMirror re-reads `editable()` on every state update, so holding the
  // flag in a ref lets it flip without rebuilding the view. Rebuilding would
  // drop the caret and the undo history, and would re-run the mount effect
  // below - the same effect whose cleanup once wiped content on toggle.
  const isEditableRef = useRef(isEditable);
  isEditableRef.current = isEditable;
  useLayoutEffect(() => {
    const mount = externalMount ?? mountRef.current;
    if (mount == null) {
      return;
    }
    const view = new EditorView(
      { mount },
      {
        state: state,
        ...{ config },
        editable: () => isEditableRef.current,
        dispatchTransaction(tr) {
          const newEditorState = view.state.apply(tr);
          view.updateState(newEditorState);
          onEditorStateChange(newEditorState);
        },
      },
    );
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountRef, onEditorStateChange, config, externalMount]);
  // `editable()` is only consulted when the view updates, so a flip that
  // isn't accompanied by a state change needs a nudge to take effect.
  useLayoutEffect(() => {
    viewRef.current?.updateState(viewRef.current.state);
  }, [isEditable]);
  useLayoutEffect(() => {
    viewRef.current?.updateState(state);
  }, [state]);
  return {
    view: viewRef,
    mount: mountRef,
  };
}

/**
 * This cannot be moved after mount
 *
 * This could be fixed by storing the editable ref in state but that would be more initial re-renders
 * and moving the editable isn't a thing that we actually would want to do.
 */
export function ProseMirrorEditable(props: HTMLAttributes<HTMLElement>) {
  const { mount } = useStableEditorContext();
  return <div {...props} ref={mount} />;
}

type StableContext = {
  view: MutableRefObject<EditorView | null>;
  mount: MutableRefObject<HTMLDivElement | null>;
  dispatchCommand: (command: Command) => void;
  schema: EditorSchema;
};

const StableEditorContext = React.createContext<StableContext | null>(null);

function useStableEditorContext() {
  const context = useContext(StableEditorContext);
  if (context === null) {
    throw new Error("editor hooks must be used inside a ProseMirrorEditorView");
  }
  return context;
}

export const ProseMirrorEditor = forwardRef(function ProseMirrorEditorView(
  props: {
    value: EditorState;
    onChange: (state: EditorState) => void;
    children: ReactNode;
    // When set, ProseMirror adopts this node instead of the one
    // <ProseMirrorEditable> would render - see useEditorView's doc comment.
    // Such a caller renders no <ProseMirrorEditable> of its own.
    mount?: HTMLElement | null;
  },
  ref: Ref<{ view: EditorView | null }>,
) {
  // Read here rather than passed in: an overlay can stop the mouse, but only
  // ProseMirror itself can stop the keyboard once the caret is inside.
  const isAiLocked = useIsAiLocked();
  const { view, mount } = useEditorView(
    props.value,
    props.onChange,
    props.mount,
    !isAiLocked,
  );

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return view.current;
      },
    }),
    [view],
  );

  const stableContext = useMemo((): StableContext => {
    return {
      view,
      mount,
      dispatchCommand: (command) => {
        if (!view.current) return;
        command(view.current.state, view.current.dispatch, view.current);
        view.current.focus();
      },
      schema: getEditorSchema(props.value.schema),
    };
  }, [mount, props.value.schema, view]);

  return (
    <StableEditorContext.Provider value={stableContext}>
      <EditorStateContext.Provider value={props.value}>
        {props.children}
      </EditorStateContext.Provider>
    </StableEditorContext.Provider>
  );
});
