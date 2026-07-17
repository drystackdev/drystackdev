import { Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog, useDialogContainer } from "@keystar/ui/dialog";
import { Content } from "@keystar/ui/slots";
import { Heading } from "@keystar/ui/typography";

import {
  MediaLibraryLocalScope,
  MediaLibraryPick,
} from "../media-library/bridge";
import { FileManagerRoot } from "./FileManagerRoot";

export function FileManagerDialog(props: {
  accept: "image" | "any" | undefined;
  selection: "single" | "multi";
  local: MediaLibraryLocalScope | undefined;
  onPick: (picks: MediaLibraryPick[]) => void;
}) {
  const { dismiss } = useDialogContainer();

  return (
    <Dialog size="large">
      <Heading>File manager</Heading>
      <Content>
        <FileManagerRoot
          mode={{
            kind: "picker",
            accept: props.accept ?? "any",
            selection: props.selection,
            local: props.local,
            // `dismiss()` calls the same `onDismiss` the DialogContainer
            // resolves the pending pick with `undefined` from - calling it
            // here would race with (and always beat) `props.onPick` below,
            // since a promise's first resolution wins. Closing happens as a
            // side effect of `props.onPick` once the caller clears its
            // pending request, so don't dismiss separately.
            onPick: (picks) => {
              props.onPick(picks);
            },
          }}
        />
      </Content>
      <ButtonGroup>
        <Button onPress={dismiss}>Cancel</Button>
      </ButtonGroup>
    </Dialog>
  );
}
