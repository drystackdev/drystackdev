import { useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../l10n";
import { Button, ButtonGroup, ActionButton } from "@keystar/ui/button";
import { Dialog } from "@keystar/ui/dialog";
import { FileTrigger } from "@keystar/ui/drag-and-drop";
import { Icon } from "@keystar/ui/icon";
import { fileUpIcon } from "#icons/fileUpIcon";
import { Flex } from "@keystar/ui/layout";
import { Content } from "@keystar/ui/slots";
import { Heading, Text } from "@keystar/ui/typography";
import { TextField } from "@keystar/ui/text-field";

function validateName(
  name: string,
  existingNames: ReadonlySet<string>,
  stringFormatter: ReturnType<typeof useLocalizedStringFormatter>,
) {
  if (!name) return undefined;
  if (
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    return stringFormatter.format("invalidFolderName");
  }
  if (existingNames.has(name)) {
    return stringFormatter.format("nameAlreadyExists");
  }
  return undefined;
}

export function NewFolderDialog(props: {
  existingNames: ReadonlySet<string>;
  isCreating: boolean;
  onCancel: () => void;
  onCreate: (name: string, files: File[]) => void;
}) {
  const [name, setName] = useState("");
  // a folder can't exist empty in this app's git-backed storage, so
  // creating one means seeding it with at least one real file
  const [files, setFiles] = useState<File[]>([]);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const trimmed = name.trim();
  const error = validateName(trimmed, props.existingNames, stringFormatter);
  const canCreate =
    !props.isCreating && !!trimmed && !error && files.length > 0;

  return (
    <Dialog size="small">
      <form
        style={{ display: "contents" }}
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (!canCreate) return;
          props.onCreate(trimmed, files);
        }}
      >
        <Heading>{stringFormatter.format("newFolderAction")}</Heading>
        <Content>
          <Flex direction="column" gap="regular">
            <TextField
              label={stringFormatter.format("folderNameLabel")}
              value={name}
              onChange={setName}
              autoFocus
              errorMessage={error}
            />
            <FileTrigger
              allowsMultiple
              onSelect={(selected) =>
                setFiles(selected ? Array.from(selected) : [])
              }
            >
              <ActionButton>
                <Icon src={fileUpIcon} />
                <Text>{stringFormatter.format("chooseFilesAction")}</Text>
              </ActionButton>
            </FileTrigger>
            <Text size="small" color="neutralSecondary">
              {files.length === 0
                ? stringFormatter.format("folderNeedsFile")
                : `${stringFormatter.format("filesSelectedLabel", {
                    count: files.length,
                  })} ${files.map((f) => f.name).join(", ")}`}
            </Text>
          </Flex>
        </Content>
        <ButtonGroup>
          <Button onPress={props.onCancel} isDisabled={props.isCreating}>
            {stringFormatter.format("cancel")}
          </Button>
          <Button
            type="submit"
            prominence="high"
            isDisabled={!canCreate}
            isPending={props.isCreating}
          >
            {stringFormatter.format("create")}
          </Button>
        </ButtonGroup>
      </form>
    </Dialog>
  );
}
