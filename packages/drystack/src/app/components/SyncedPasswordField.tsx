import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { Icon } from '@keystar/ui/icon';
import { eyeIcon } from '@keystar/ui/icon/icons/eyeIcon';
import { eyeOffIcon } from '@keystar/ui/icon/icons/eyeOffIcon';
import { css, tokenSchema } from '@keystar/ui/style';
import { TextField, TextFieldProps } from '@keystar/ui/text-field';

import l10nMessages from '../l10n';
import { usePasswordVisibility } from '../password-visibility';

// A plain icon toggle, not @keystar/ui's ActionButton - matches the login
// page's password field (packages/astro/internal/drystack-login.astro),
// which is the look this was asked to line up with: a single seamless
// field with a borderless icon at the end, not a separate boxed button
// sitting inside it.
const toggleButtonStyle = css({
  alignItems: 'center',
  background: 'transparent',
  border: 0,
  color: tokenSchema.color.foreground.neutralTertiary,
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'center',
  padding: 0,
  width: tokenSchema.size.element.regular,

  '&:hover': {
    color: tokenSchema.color.foreground.neutral,
  },
  '&:focus-visible': {
    color: tokenSchema.color.foreground.neutral,
    outline: `2px solid ${tokenSchema.color.alias.borderFocused}`,
    outlineOffset: '-2px',
  },
  '&:disabled': {
    color: tokenSchema.color.alias.foregroundDisabled,
    cursor: 'default',
  },
});

// A password TextField whose show/hide state is shared (via zustand) with
// every other SyncedPasswordField mounted at the same time - toggling
// reveal on one field reveals them all, instead of each field keeping its
// own hidden local state.
export function SyncedPasswordField(
  props: Omit<TextFieldProps, 'type' | 'endElement'>
) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const visible = usePasswordVisibility(state => state.visible);
  const toggle = usePasswordVisibility(state => state.toggle);

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      endElement={
        <button
          type="button"
          className={toggleButtonStyle}
          aria-label={stringFormatter.format(
            visible ? 'hidePasswordAction' : 'showPasswordAction'
          )}
          onClick={toggle}
          disabled={props.isDisabled}
        >
          <Icon src={visible ? eyeOffIcon : eyeIcon} />
        </button>
      }
    />
  );
}
