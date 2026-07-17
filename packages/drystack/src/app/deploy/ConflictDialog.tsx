import { useState } from "react";
import type { Key } from "@react-types/shared";

import { ActionGroup } from "@keystar/ui/action-group";
import { Badge } from "@keystar/ui/badge";
import { Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog } from "@keystar/ui/dialog";
import { Flex, Grid, ScrollView } from "@keystar/ui/layout";
import { Content } from "@keystar/ui/slots";
import { css, tokenSchema } from "@keystar/ui/style";
import { Item, TabList, TabPanels, Tabs } from "@keystar/ui/tabs";
import { Heading, Text } from "@keystar/ui/typography";

import type { ConflictFileState } from "./useDeploy";

// Hunk-level 3-way merge UI (plan/brand.md §7). Rendered inside a
// `<DialogContainer type="fullscreen">` by DeployButton - Dialog itself has
// no `type` prop, only DialogContainer/DialogTrigger do.
export function ConflictDialog(props: {
  files: ConflictFileState[];
  onChoice: (
    path: string,
    hunkIndex: number,
    choice: "ours" | "theirs",
  ) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Key | null>(
    props.files[0]?.path ?? null,
  );

  const totalHunks = props.files.reduce((n, f) => n + f.choices.length, 0);
  const resolvedHunks = props.files.reduce(
    (n, f) => n + f.choices.filter((c) => c !== null).length,
    0,
  );
  const allResolved = totalHunks > 0 && resolvedHunks === totalHunks;

  return (
    <Dialog aria-label="Giải quyết xung đột trước khi deploy">
      <Heading>Giải quyết xung đột trước khi deploy</Heading>
      <Content>
        <Flex direction="column" height="100%" gap="regular">
          <Tabs
            aria-label="File xung đột"
            selectedKey={selected}
            onSelectionChange={setSelected}
            flex
            minHeight={0}
          >
            <TabList>
              {props.files.map((file) => {
                const unresolved = file.choices.filter(
                  (c) => c === null,
                ).length;
                return (
                  <Item key={file.path} textValue={file.path}>
                    <Text>{file.path}</Text>
                    {unresolved > 0 && (
                      <Badge tone="caution" marginStart="small">
                        <Text>{unresolved}</Text>
                      </Badge>
                    )}
                  </Item>
                );
              })}
            </TabList>
            <TabPanels UNSAFE_className={css({ flex: 1, minHeight: 0 })}>
              {props.files.map((file) => (
                <Item key={file.path} textValue={file.path}>
                  <ScrollView height="100%">
                    <FileHunks
                      file={file}
                      onChoice={(hunkIndex, choice) =>
                        props.onChoice(file.path, hunkIndex, choice)
                      }
                    />
                  </ScrollView>
                </Item>
              ))}
            </TabPanels>
          </Tabs>
        </Flex>
      </Content>
      <ButtonGroup>
        <Text color="neutralSecondary" marginEnd="auto">
          Đã giải quyết {resolvedHunks}/{totalHunks}
        </Text>
        <Button onPress={props.onCancel}>Huỷ</Button>
        <Button
          prominence="high"
          isDisabled={!allResolved}
          onPress={props.onSubmit}
        >
          Hoàn tất &amp; Deploy
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

const codeBlock = css({
  fontFamily: tokenSchema.typography.fontFamily.code,
  fontSize: tokenSchema.typography.text.small.size,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
});

function FileHunks(props: {
  file: ConflictFileState;
  onChoice: (hunkIndex: number, choice: "ours" | "theirs") => void;
}) {
  let conflictIndex = -1;
  return (
    <Flex direction="column" gap="regular" padding="large">
      {props.file.hunks.map((hunk, i) => {
        if (hunk.kind === "ok") {
          if (hunk.lines.length === 0) return null;
          return (
            <Text key={i} UNSAFE_className={codeBlock} color="neutralTertiary">
              {hunk.lines.join("")}
            </Text>
          );
        }

        conflictIndex++;
        const hunkIndex = conflictIndex;
        const choice = props.file.choices[hunkIndex];

        return (
          <Flex
            key={i}
            direction="column"
            gap="regular"
            border="critical"
            borderRadius="regular"
            padding="regular"
          >
            <ActionGroup
              aria-label={`Chọn phiên bản cho xung đột #${hunkIndex + 1}`}
              selectionMode="single"
              selectedKeys={choice ? [choice] : []}
              onSelectionChange={(keys) => {
                const [key] = [...keys];
                if (key === "ours" || key === "theirs") {
                  props.onChoice(hunkIndex, key);
                }
              }}
            >
              <Item key="ours">Brand (của bạn)</Item>
              <Item key="theirs">Main (hiện tại)</Item>
            </ActionGroup>
            <Grid columns="1fr 1fr" gap="regular">
              <Flex direction="column" gap="xsmall">
                <Text
                  size="small"
                  weight="semibold"
                  color={choice === "ours" ? "positive" : "neutralTertiary"}
                >
                  Brand
                </Text>
                <Text UNSAFE_className={codeBlock}>
                  {hunk.ours.join("") || "(trống - file bị xoá)"}
                </Text>
              </Flex>
              <Flex direction="column" gap="xsmall">
                <Text
                  size="small"
                  weight="semibold"
                  color={choice === "theirs" ? "positive" : "neutralTertiary"}
                >
                  Main
                </Text>
                <Text UNSAFE_className={codeBlock}>
                  {hunk.theirs.join("") || "(trống - file bị xoá)"}
                </Text>
              </Flex>
            </Grid>
          </Flex>
        );
      })}
    </Flex>
  );
}
