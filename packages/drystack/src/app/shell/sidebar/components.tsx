import { PressProps } from '@react-aria/interactions';
import { Item } from '@react-stately/collections';
import { ForwardedRef, ReactElement, forwardRef, useMemo } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';
import l10nMessages from '../../l10n';

import { Avatar } from '@keystar/ui/avatar';
import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { logOutIcon } from '@keystar/ui/icon/icons/logOutIcon';
import { monitorIcon } from '@keystar/ui/icon/icons/monitorIcon';
import { moonIcon } from '@keystar/ui/icon/icons/moonIcon';
import { sunIcon } from '@keystar/ui/icon/icons/sunIcon';
import { userIcon } from '@keystar/ui/icon/icons/userIcon';
import { Flex } from '@keystar/ui/layout';
import { Menu, MenuTrigger } from '@keystar/ui/menu';
import { ClearSlots } from '@keystar/ui/slots';
import { css, useMediaQuery } from '@keystar/ui/style';
import { ColorScheme } from '@keystar/ui/types';
import { Text } from '@keystar/ui/typography';

import { useRouter } from '../../router';
import { isR2Config } from '../../utils';

import { useConfig } from '../context';
import { useThemeContext } from '../theme';
import { clearObjectCache } from '../../object-cache';
import { clearDrafts } from '../../persistence';
import { nativeLogout, useNativeUser } from '../../native-user';
import { avatarUrl } from '../../user-management/format';

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
  light: { icon: sunIcon, labelKey: 'themeLight' },
  dark: { icon: moonIcon, labelKey: 'themeDark' },
  auto: { icon: monitorIcon, labelKey: 'themeSystem' },
} as const;

export function ThemeMenu() {
  let { theme, setTheme } = useThemeContext();
  let matchesDark = useMediaQuery('(prefers-color-scheme: dark)');
  let stringFormatter = useLocalizedStringFormatter(l10nMessages);
  let icon = THEME_MODE[theme].icon;
  if (theme === 'auto') {
    icon = matchesDark ? moonIcon : sunIcon;
  }
  let themeItems = useMemo(
    () =>
      Object.entries(THEME_MODE).map(([id, { icon, labelKey }]) => ({
        id,
        icon,
        label: stringFormatter.format(labelKey),
      })),
    [stringFormatter],
  );

  return (
    <MenuTrigger align="end">
      <ActionButton
        aria-label={stringFormatter.format('themeMenuAriaLabel')}
        prominence="low"
      >
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
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const menuItems = useMemo(() => {
    let items: MenuItem[] = [];
    if (isR2Config(config)) {
      items.push({
        key: 'profile',
        label: stringFormatter.format('profileAction'),
        href: `${basePath}/profile`,
        icon: userIcon,
      });
    }
    items.push({
      key: 'logout',
      label: stringFormatter.format('logOutAction'),
      // r2's logout revokes the session's jti (POST-only, see api-r2.ts),
      // so it has no `href` and instead runs through `nativeLogout` in
      // `onAction` below.
      icon: logOutIcon,
    });
    return items;
  }, [config, basePath, stringFormatter]);

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
          onAction={async key => {
            await Promise.all([clearObjectCache(), clearDrafts()]);
            if (key === 'logout' && isR2Config(config)) {
              await nativeLogout(basePath);
            }
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
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <ActionButton
      {...otherProps}
      ref={ref}
      aria-label={stringFormatter.format('userMenuAriaLabel')}
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
  const nativeUser = useNativeUser();
  const { basePath } = useRouter();

  if (isR2Config(config) && nativeUser) {
    return {
      login: nativeUser.email,
      name: nativeUser.name || nativeUser.email,
      avatarUrl: nativeUser.avatar ? avatarUrl(basePath, nativeUser.avatar) : undefined,
    };
  }

  return undefined;
}
