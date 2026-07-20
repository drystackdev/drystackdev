import { useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../l10n";

import { Button } from "@keystar/ui/button";
import { Box, Flex } from "@keystar/ui/layout";
import { css } from "@keystar/ui/style";
import { TextField } from "@keystar/ui/text-field";
import { Heading, Text } from "@keystar/ui/typography";
import { GitHubConfig } from "../..";
import { parseRepoConfig } from "../repo-config";
import { useRouter } from "../router";
import { DrystackLogo } from "../shell/common";

function tryAbsoluteURL(path: string, base: string) {
  try {
    return new URL(path, base).toString();
  } catch {
    return undefined;
  }
}

export function DrystackSetup(props: { config: GitHubConfig }) {
  const { basePath } = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const apiBasePath = `/api${basePath}`;
  const [deployedURL, setDeployedURL] = useState("");
  const [organization, setOrganization] = useState("");
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
        elementType="form"
        action={`https://github.com${
          organization ? `/organizations/${organization}` : ""
        }/settings/apps/new`}
        method="post"
      >
        <Flex justifyContent="center">
          <DrystackLogo />
        </Flex>
        <Text>{stringFormatter.format("setupMissingConfigNotice")}</Text>
        <Text>{stringFormatter.format("setupExistingAppNotice")}</Text>
        <Box elementType="ul">
          <li>
            <code>DRYSTACK_GITHUB_CLIENT_ID</code>
          </li>
          <li>
            <code>DRYSTACK_GITHUB_CLIENT_SECRET</code>
          </li>
          <li>
            <code>DRYSTACK_SECRET</code>
          </li>
        </Box>
        <Text>{stringFormatter.format("setupCreateAppNotice")}</Text>
        <TextField
          label={stringFormatter.format("setupDeployedUrlLabel")}
          description={stringFormatter.format("setupDeployedUrlDescription")}
          value={deployedURL}
          onChange={setDeployedURL}
        />
        <TextField
          label={stringFormatter.format("setupOrgLabel")}
          description={stringFormatter.format("setupOrgDescription")}
          value={organization}
          onChange={setOrganization}
        />
        <Text>{stringFormatter.format("setupRedirectNotice")}</Text>
        <input
          type="text"
          name="manifest"
          className={css({ display: "none" })}
          defaultValue={JSON.stringify({
            name: `${
              parseRepoConfig(props.config.storage.repo).owner
            } Drystack`,
            url:
              (deployedURL && tryAbsoluteURL(basePath, deployedURL)) ||
              `${window.location.origin}${basePath}`,
            public: true,
            redirect_url: `${window.location.origin}${apiBasePath}/github/created-app`,
            callback_urls: [
              `${window.location.origin}${apiBasePath}/github/oauth/callback`,
              `http://127.0.0.1${apiBasePath}/github/oauth/callback`,
              ...(deployedURL
                ? [
                    tryAbsoluteURL(
                      `${apiBasePath}/github/oauth/callback`,
                      deployedURL,
                    ),
                  ].filter((url): url is string => url != null)
                : []),
            ],
            request_oauth_on_install: true,
            default_permissions: {
              contents: "write",
              metadata: "read",
              pull_requests: "read",
            },
          })}
        />
        <Button prominence="high" type="submit">
          {stringFormatter.format("setupCreateAppAction")}
        </Button>
      </Flex>
    </Flex>
  );
}
