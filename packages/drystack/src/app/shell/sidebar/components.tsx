import { PressProps } from '@react-aria/interactions';
import { Item } from '@react-stately/collections';
import { ForwardedRef, ReactElement, forwardRef, useMemo } from 'react';

import { Avatar } from '@keystar/ui/avatar';
import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { logOutIcon } from '@keystar/ui/icon/icons/logOutIcon';
import { monitorIcon } from '@keystar/ui/icon/icons/monitorIcon';
import { moonIcon } from '@keystar/ui/icon/icons/moonIcon';
import { sunIcon } from '@keystar/ui/icon/icons/sunIcon';
import { Flex } from '@keystar/ui/layout';
import { Menu, MenuTrigger } from '@keystar/ui/menu';
import { ClearSlots } from '@keystar/ui/slots';
import { css, useMediaQuery } from '@keystar/ui/style';
import { ColorScheme } from '@keystar/ui/types';
import { Text } from '@keystar/ui/typography';

import { useRouter } from '../../router';
import { isGitHubConfig } from '../../utils';

import { useConfig } from '../context';
import { useViewer } from '../viewer-data';
import { useThemeContext } from '../theme';
import { clearObjectCache } from '../../object-cache';
import { clearDrafts } from '../../persistence';

type MenuItem = {
  icon: ReactElement;
  label: string;
  description?: string;
  key: string;
  href?: string;
  target?: string;
  rel?: string;
};

// Theme controls
// -----------------------------------------------------------------------------

const THEME_MODE = {
  light: { icon: sunIcon, label: 'Light' },
  dark: { icon: moonIcon, label: 'Dark' },
  auto: { icon: monitorIcon, label: 'System' },
} as const;
const themeItems = Object.entries(THEME_MODE).map(([id, { icon, label }]) => ({
  id,
  icon,
  label,
}));

export function ThemeMenu() {
  let { theme, setTheme } = useThemeContext();
  let matchesDark = useMediaQuery('(prefers-color-scheme: dark)');
  let icon = THEME_MODE[theme].icon;
  if (theme === 'auto') {
    icon = matchesDark ? moonIcon : sunIcon;
  }

  return (
    <MenuTrigger align="end">
      <ActionButton aria-label="theme" prominence="low">
        <Icon src={icon} />
      </ActionButton>
      <Menu
        items={themeItems}
        onSelectionChange={([key]) => setTheme(key as ColorScheme)}
        disallowEmptySelection
        selectedKeys={[theme]}
        selectionMode="single"
      >
        {item => (
          <Item textValue={item.label}>
            <Icon src={item.icon} />
            <Text>{item.label}</Text>
          </Item>
        )}
      </Menu>
    </MenuTrigger>
  );
}

// User controls
// -----------------------------------------------------------------------------

type UserData = {
  name: string;
  avatarUrl?: string;
  login: string;
};

export function UserActions() {
  let userData = useUserData();

  if (!userData) {
    return null;
  }

  return <UserMenu {...userData} />;
}

export function UserMenu(user: {
  name: string;
  avatarUrl?: string;
  login: string;
}) {
  let config = useConfig();
  const { basePath } = useRouter();

  const menuItems = useMemo(() => {
    let items: MenuItem[] = [
      {
        key: 'logout',
        label: 'Log out',
        href:
          config.storage.kind === 'github'
            ? `/api${basePath}/github/logout`
            : undefined,
        icon: logOutIcon,
      },
    ];
    return items;
  }, [config, basePath]);

  if (!user) {
    return null;
  }

  return (
    <MenuTrigger>
      <UserDetailsButton {...user} />
      <>
        <Menu
          items={menuItems}
          minWidth="scale.2400"
          onAction={async () => {
            await Promise.all([clearObjectCache(), clearDrafts()]);
          }}
        >
          {item => (
            <Item
              key={item.key}
              textValue={item.label}
              href={item.href}
              rel={item.rel}
              target={item.target}
            >
              <Icon src={item.icon} />
              <Text>{item.label}</Text>
            </Item>
          )}
        </Menu>
      </>
    </MenuTrigger>
  );
}

const UserDetailsButton = forwardRef(function UserDetailsButton(
  props: UserData & PressProps,
  ref: ForwardedRef<HTMLButtonElement>
) {
  let { avatarUrl, login, name, ...otherProps } = props;
  return (
    <ActionButton
      {...otherProps}
      ref={ref}
      aria-label="User menu"
      prominence="low"
      flexGrow={1}
      UNSAFE_className={css({ justifyContent: 'start', textAlign: 'start' })}
    >
      <Flex alignItems="center" gap="regular">
        <Avatar src={avatarUrl} name={name ?? undefined} size="small" />
        <ClearSlots>
          <Flex direction="column" gap="small">
            <Text size="small" weight="semibold" color="neutralEmphasis">
              {name}
            </Text>
            {name === login ? null : (
              <Text size="small" color="neutralTertiary">
                {login}
              </Text>
            )}
          </Flex>
        </ClearSlots>
      </Flex>
    </ActionButton>
  );
});

// Utils
// -----------------------------------------------------------------------------

function useUserData(): UserData | undefined {
  const config = useConfig();
  const user = useViewer();

  if (isGitHubConfig(config) && user) {
    return {
      avatarUrl: user.avatarUrl,
      login: user.login,
      name: user.name ?? user.login,
    };
  }

  return undefined;
}
