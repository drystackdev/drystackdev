import { useEffect, useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../l10n";
import { Flex } from "@keystar/ui/layout";
import { Notice } from "@keystar/ui/notice";
import { Heading, Text } from "@keystar/ui/typography";
import { GitHubConfig } from "../..";
import { InstallGitHubApp } from "./install-app";
import { serializeRepoConfig } from "../repo-config";
import { useRouter } from "../router";
import { CopySecretField } from "./copy-secret-field";

const SECRET_KEYS = [
  "DRYSTACK_GITHUB_CLIENT_ID",
  "DRYSTACK_GITHUB_CLIENT_SECRET",
  "DRYSTACK_SECRET",
] as const;

function readSecretsFromHash(): Record<string, string> | undefined {
  const hash = window.location.hash;
  if (!hash) return undefined;
  const params = new URLSearchParams(hash.slice(1));
  const secrets: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const value = params.get(key);
    if (!value) return undefined;
    secrets[key] = value;
  }
  return secrets;
}

export function CreatedGitHubApp(props: { config: GitHubConfig }) {
  const router = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [secrets, setSecrets] = useState<Record<string, string>>();
  useEffect(() => {
    if (!window.location.hash) return;
    setSecrets(readSecretsFromHash());
    // strip the secrets from the URL/history whether or not they parsed -
    // nothing should linger in the address bar or tab-restore state.
    router.replace(router.href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Flex alignItems="center" justifyContent="center" margin="xxlarge">
      <Flex
        backgroundColor="surface"
        padding="large"
        border="color.alias.borderIdle"
        borderRadius="medium"
        direction="column"
        justifyContent="center"
        gap="xlarge"
        maxWidth="scale.4600"
      >
        <Heading>{stringFormatter.format("installedDrystackHeading")}</Heading>
        {secrets && (
          <>
            <Notice tone="caution">
              <Text>{stringFormatter.format("secretsNotSavedNotice")}</Text>
            </Notice>
            {SECRET_KEYS.map((key) => (
              <CopySecretField
                key={key}
                label={<code>{key}</code>}
                value={secrets[key]}
              />
            ))}
          </>
        )}
        <Text>{stringFormatter.format("needInstallAppNotice")}</Text>
        <Text>
          {stringFormatter.format("addAppToRepoPrefix")}{" "}
          <code>{serializeRepoConfig(props.config.storage.repo)}</code>{" "}
          {stringFormatter.format("addAppToRepoSuffix")}
        </Text>
        <InstallGitHubApp config={props.config} />
      </Flex>
    </Flex>
  );
}
