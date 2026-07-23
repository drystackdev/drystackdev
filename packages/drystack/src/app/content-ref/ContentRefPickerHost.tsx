import { useEffect, useState } from "react";
import { DialogContainer } from "@keystar/ui/dialog";
import type { EntryRef } from "../path-utils";
import { registerContentRefPickerOpener } from "./bridge";
import type { ContentRefPick } from "./bridge";
import { ContentRefPickerDialog } from "./ContentRefPickerDialog";

export function ContentRefPickerHost() {
  const [request, setRequest] = useState<{
    excludeRef: EntryRef | null;
    resolve: (pick: ContentRefPick | undefined) => void;
  } | null>(null);

  useEffect(() => {
    registerContentRefPickerOpener((options) => {
      return new Promise((resolve) => {
        setRequest({ excludeRef: options.excludeRef, resolve });
      });
    });
    return () => registerContentRefPickerOpener(null);
  }, []);

  const resolveAndClose = (pick: ContentRefPick | undefined) => {
    request?.resolve(pick);
    setRequest(null);
  };

  return (
    <DialogContainer onDismiss={() => resolveAndClose(undefined)}>
      {request && (
        <ContentRefPickerDialog
          excludeRef={request.excludeRef}
          onSubmit={(pick) => resolveAndClose(pick)}
        />
      )}
    </DialogContainer>
  );
}
