import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { useEffect, useId, useMemo, useState } from 'react';

import { base64UrlEncode } from '#base64';
import { Avatar } from '@keystar/ui/avatar';
import { Button, ButtonGroup } from '@keystar/ui/button';
import { FieldLabel } from '@keystar/ui/field';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { ProgressCircle } from '@keystar/ui/progress';
import { TextField } from '@keystar/ui/text-field';
import { toastQueue } from '@keystar/ui/toast';

import { ComponentSchema, ObjectField } from '../../form/api';
import { clientSideValidateProp } from '../../form/errors';
import * as fields from '../../form/fields';
import { getUploadedFileObject } from '../../form/fields/image/ui';
import { FormValueContentFromPreviewProps } from '../../form/form-from-preview';
import { getInitialPropsValue } from '../../form/initial-values';

import l10nMessages from '../l10n';
import { useRefreshNativeUser } from '../native-user';
import { usePreviewProps } from '../preview-props';
import { useRouter } from '../router';
import { useConfig } from '../shell/context';
import { HeaderBreadcrumbs } from '../shell/HeaderBreadcrumbs';
import { PageBody, PageHeader, PageRoot } from '../shell/page';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// Built-ins every user has outside the declared schema - reserved so a site's
// own `config.user.schema` can never shadow one (which would collide with the
// literal column/route keys UsersPage and the auth API use for them).
const RESERVED_USER_FIELD_KEYS = new Set([
  'email',
  'avatar',
  'password',
  'createdAt',
]);

// The editable user profile schema, from `config.user` (r2 mode). Falls back to
// a single name field so a deployment that never declared `user` still gets a
// usable profile/edit form. `avatar` and `password` are deliberately NOT part
// of this schema - they're built-ins handled by AvatarField / PasswordSection.
export function useUserSchema(): ObjectField<Record<string, ComponentSchema>> {
  const config = useConfig();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return useMemo(() => {
    const declared = config.user?.schema;
    if (!declared) {
      return {
        kind: 'object' as const,
        fields: {
          name: fields.text({
            label: stringFormatter.format('userNameColumn'),
          }),
        } as Record<string, ComponentSchema>,
      };
    }
    const fieldEntries = Object.entries(declared).filter(
      ([key]) => !RESERVED_USER_FIELD_KEYS.has(key)
    );
    return {
      kind: 'object' as const,
      fields: Object.fromEntries(fieldEntries),
    };
  }, [config.user, stringFormatter]);
}

// Seeds form state from the schema's initial values, then overlays the stored
// profile - but only for keys the schema actually declares, so the value stays
// schema-shaped (the preview-props machinery drops unknown keys anyway).
// `storedProfile` is `unknown` at the type level for good reason: it's
// whatever JSON happens to be sitting in the user file's `profile` key, which
// predates (and isn't validated against) the site's current schema - a stale
// dev record, a hand-edited bucket object, or a schema that changed shape
// since the profile was last saved can all hand back something that isn't a
// plain object (confirmed against real local-dev data: a legacy record whose
// `profile` was a bare string crashed `key in stored` with a TypeError before
// this guard existed). Anything other than a plain object is treated as "no
// stored profile", same as null/undefined.
function useInitialState(
  schema: ObjectField<Record<string, ComponentSchema>>,
  storedProfile: unknown
): Record<string, unknown> {
  return useMemo(() => {
    const base = getInitialPropsValue(schema) as Record<string, unknown>;
    const stored = (
      storedProfile && typeof storedProfile === 'object'
        ? storedProfile
        : {}
    ) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...base };
    for (const key of Object.keys(schema.fields)) {
      if (key in stored) merged[key] = stored[key];
    }
    return merged;
  }, [schema, storedProfile]);
}

function profileDisplayName(
  state: Record<string, unknown>,
  fallback: string
): string {
  const name = state.name;
  return typeof name === 'string' && name.trim() ? name : fallback;
}

// Base64url-encode an avatar file's bytes for the JSON avatar route.
async function encodeAvatar(file: File): Promise<string> {
  return base64UrlEncode(new Uint8Array(await file.arrayBuffer()));
}

// Built-in avatar control, rendered as an inline form field (FieldLabel +
// preview + pick button) so it sits in the same rhythm as the schema fields
// around it - matching how a collection item's image field looks, but picking
// a file DIRECTLY from the OS (getUploadedFileObject) rather than opening the
// media-library dialog the content-tree image field uses. The avatar is
// stored/served through the auth API (`auth/avatar[/<email>]`), not the
// content-tree image pipeline. Two behaviours: `deferUpload` (create form)
// hands the picked file back to the parent, which uploads it once the invited
// email exists; otherwise it uploads immediately to the given email (self/edit).
export function AvatarField(props: {
  // Target user; omit for self (server falls back to the caller's own email).
  email?: string;
  name: string;
  initialHasAvatar: boolean;
  deferUpload?: boolean;
  onFilePicked?: (file: File | undefined) => void;
  onUploaded?: () => void | Promise<void>;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { basePath } = useRouter();
  const apiBase = `/api${basePath}/auth`;
  const [isUploading, setUploading] = useState(false);
  // Local object URL for the just-picked bytes - the avatar route URL doesn't
  // change when the image does, so relying on it alone would show the old
  // avatar until a full navigation (same reasoning as the media library's
  // pending-blob caching).
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  // whether a file has been picked locally this session but not yet committed
  // (create/defer flow) - gates the Remove affordance, which only undoes a
  // pending local pick (there's no server-side avatar-delete route).
  const [pickedLocally, setPickedLocally] = useState(false);
  const labelId = useId();

  const avatarUrl =
    previewUrl ??
    (props.initialHasAvatar && props.email
      ? `${apiBase}/avatar/${encodeURIComponent(props.email)}`
      : undefined);

  async function pick() {
    const file = await getUploadedFileObject('image/*');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toastQueue.critical(stringFormatter.format('avatarInvalidTypeError'));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toastQueue.critical(stringFormatter.format('avatarTooLargeError'));
      return;
    }
    if (props.deferUpload) {
      setPreviewUrl(URL.createObjectURL(file));
      setPickedLocally(true);
      props.onFilePicked?.(file);
      return;
    }
    setUploading(true);
    try {
      const contents = base64UrlEncode(
        new Uint8Array(await file.arrayBuffer())
      );
      const res = await fetch(`${apiBase}/avatar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          contentType: file.type,
          ...(props.email ? { email: props.email } : {}),
        }),
      });
      if (!res.ok) {
        toastQueue.critical(stringFormatter.format('genericErrorToast'));
        return;
      }
      setPreviewUrl(URL.createObjectURL(file));
      toastQueue.positive(stringFormatter.format('avatarUpdatedToast'));
      await props.onUploaded?.();
    } finally {
      setUploading(false);
    }
  }

  function clearPending() {
    setPreviewUrl(undefined);
    setPickedLocally(false);
    props.onFilePicked?.(undefined);
  }

  return (
    <Flex
      direction="column"
      gap="medium"
      role="group"
      aria-labelledby={labelId}
    >
      <FieldLabel id={labelId} elementType="span">
        {stringFormatter.format('avatarSectionTitle')}
      </FieldLabel>
      <Flex alignItems="center" gap="large">
        <Avatar src={avatarUrl} name={props.name} size="xlarge" />
        <ButtonGroup>
          <Button onPress={pick} isPending={isUploading}>
            {stringFormatter.format('changeAvatarAction')}
          </Button>
          {props.deferUpload && pickedLocally && (
            <Button prominence="low" onPress={clearPending}>
              {stringFormatter.format('remove')}
            </Button>
          )}
        </ButtonGroup>
      </Flex>
    </Flex>
  );
}

// Shared profile-form state + save wiring for an existing user, so the admin
// edit page and the signed-in user's own profile page drive the exact same
// schema-driven form and REST save path (`auth/users/update`) - only the page
// chrome around them (where the Save button lives) differs.
function useUserProfileForm(
  email: string,
  initialProfile: unknown,
  mode: 'self' | 'edit'
) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { basePath } = useRouter();
  const apiBase = `/api${basePath}/auth`;
  const refreshNativeUser = useRefreshNativeUser();
  const schema = useUserSchema();

  const initialState = useInitialState(schema, initialProfile);
  const [state, setState] = useState(initialState);
  const previewProps = usePreviewProps(schema, setState, state);
  const [forceValidation, setForceValidation] = useState(false);
  const [isSaving, setSaving] = useState(false);

  async function onSave() {
    if (!clientSideValidateProp(schema, state, undefined)) {
      setForceValidation(true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/users/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, profile: state }),
      });
      if (!res.ok) {
        toastQueue.critical(stringFormatter.format('genericErrorToast'));
        return;
      }
      toastQueue.positive(stringFormatter.format('userUpdatedToast'));
      if (mode === 'self') await refreshNativeUser();
    } finally {
      setSaving(false);
    }
  }

  return {
    state,
    previewProps,
    forceValidation,
    isSaving,
    onSave,
    refreshNativeUser,
    displayName: profileDisplayName(state, email),
  };
}

// The signed-in user's own profile form (rendered by ProfilePage). Keeps its
// Save button inline at the bottom, since the profile page's header has no
// action slot. The admin edit page (EditUserPage below) shares the same form
// wiring but hoists Save into the header to match the collection item page.
export function UserFields(props: {
  email: string;
  initialProfile: unknown;
  initialHasAvatar: boolean;
  mode: 'self' | 'edit';
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const form = useUserProfileForm(props.email, props.initialProfile, props.mode);

  return (
    <Flex direction="column" gap="xxlarge">
      <form
        onSubmit={event => {
          event.preventDefault();
          form.onSave();
        }}
      >
        <Flex direction="column" gap="xlarge">
          <AvatarField
            email={props.email}
            name={form.displayName}
            initialHasAvatar={props.initialHasAvatar}
            onUploaded={props.mode === 'self' ? form.refreshNativeUser : undefined}
          />
          <FormValueContentFromPreviewProps
            {...form.previewProps}
            forceValidation={form.forceValidation}
          />
          <ButtonGroup>
            <Button type="submit" prominence="high" isPending={form.isSaving}>
              {stringFormatter.format('save')}
            </Button>
          </ButtonGroup>
        </Flex>
      </form>
    </Flex>
  );
}

const EDIT_FORM_ID = 'user-edit-form';

// The admin "edit user" form once the user's data has loaded. Mirrors the
// collection item page's chrome: breadcrumbs + a Save button pinned top-right
// in the header (submitting the form by id), with the avatar + schema fields in
// a scrollable body. Password is intentionally absent - an admin doesn't set
// another user's password (they set their own on /profile; new users set theirs
// via the invite link).
function EditUserForm(props: {
  email: string;
  initialProfile: unknown;
  initialHasAvatar: boolean;
  pending: boolean;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { basePath } = useRouter();
  const form = useUserProfileForm(props.email, props.initialProfile, 'edit');

  const breadcrumbs = [
    {
      key: 'users',
      label: stringFormatter.format('userManagement'),
      href: `${basePath}/users`,
    },
    { key: 'current', label: props.email },
  ];

  return (
    <PageRoot>
      <PageHeader>
        <HeaderBreadcrumbs items={breadcrumbs} />
        <Button
          form={EDIT_FORM_ID}
          type="submit"
          prominence="high"
          isPending={form.isSaving}
          marginStart="auto"
        >
          {stringFormatter.format('save')}
        </Button>
      </PageHeader>
      <PageBody isScrollable>
        <Flex
          id={EDIT_FORM_ID}
          elementType="form"
          onSubmit={event => {
            event.preventDefault();
            form.onSave();
          }}
          direction="column"
          gap="xlarge"
          maxWidth="scale.4600"
        >
          {props.pending && (
            <Notice tone="neutral">
              {stringFormatter.format('pendingInviteEditNotice')}
            </Notice>
          )}
          <AvatarField
            email={props.email}
            name={form.displayName}
            initialHasAvatar={props.initialHasAvatar}
          />
          <FormValueContentFromPreviewProps
            {...form.previewProps}
            forceValidation={form.forceValidation}
          />
        </Flex>
      </PageBody>
    </PageRoot>
  );
}

// Admin "edit user" page: fetch the user, then hand off to EditUserForm (which
// owns the item-page-style chrome). Mirrors the collection item page's loading
// behavior - a centered spinner while fetching, before the header/breadcrumbs
// appear with the loaded form.
export function EditUserPage(props: { email: string }) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { basePath } = useRouter();
  const apiBase = `/api${basePath}/auth`;
  const [data, setData] = useState<
    | { profile: unknown; hasAvatar: boolean; pending: boolean }
    | null
    | undefined
  >(undefined);

  useEffect(() => {
    let active = true;
    setData(undefined);
    fetch(`${apiBase}/users/${encodeURIComponent(props.email)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (active) {
          setData(
            body
              ? {
                  profile: body.profile ?? {},
                  hasAvatar: !!body.hasAvatar,
                  pending: !!body.pending,
                }
              : null
          );
        }
      })
      .catch(() => {
        if (active) setData(null);
      });
    return () => {
      active = false;
    };
  }, [apiBase, props.email]);

  if (data === undefined) {
    return (
      <Flex alignItems="center" justifyContent="center" minHeight="scale.3000">
        <ProgressCircle
          aria-label={stringFormatter.format('loadingItem')}
          isIndeterminate
          size="large"
        />
      </Flex>
    );
  }

  if (data === null) {
    return (
      <PageRoot>
        <PageBody>
          <Notice tone="caution">
            {stringFormatter.format('userNotFound')}
          </Notice>
        </PageBody>
      </PageRoot>
    );
  }

  return (
    <EditUserForm
      key={props.email}
      email={props.email}
      initialProfile={data.profile}
      initialHasAvatar={data.hasAvatar}
      pending={data.pending}
    />
  );
}

const CREATE_FORM_ID = 'user-create-form';

// Admin "create user" page: the same schema-driven profile form the edit page
// uses, plus an email field, minus any password input. Submitting sends an
// invite (see the `users` POST route); the invitee sets their own password from
// the emailed link. Matches the collection create page's chrome (breadcrumbs +
// a primary action pinned top-right in the header).
export function CreateUserPage() {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const router = useRouter();
  const { basePath } = router;
  const apiBase = `/api${basePath}/auth`;
  const schema = useUserSchema();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [state, setState] = useState(
    () => getInitialPropsValue(schema) as Record<string, unknown>
  );
  const previewProps = usePreviewProps(schema, setState, state);
  const [avatarFile, setAvatarFile] = useState<File | undefined>(undefined);
  const [forceValidation, setForceValidation] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  async function onCreate() {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError(stringFormatter.format('emailRequiredError'));
      return;
    }
    if (!clientSideValidateProp(schema, state, undefined)) {
      setForceValidation(true);
      return;
    }
    setSubmitting(true);
    setEmailError(undefined);
    try {
      const res = await fetch(`${apiBase}/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed, profile: state }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setEmailError(
          body?.error === 'already-exists'
            ? stringFormatter.format('emailAlreadyExistsError')
            : body?.error === 'invalid-email'
              ? stringFormatter.format('emailRequiredError')
              : body?.error === 'email-not-configured'
                ? stringFormatter.format('emailNotConfiguredError')
                : body?.error === 'email-failed'
                  ? stringFormatter.format('emailSendFailedError')
                  : stringFormatter.format('genericErrorToast')
        );
        return;
      }
      // Upload the picked avatar now that the (pending) account's email exists;
      // bytes are keyed by email, so they're waiting when the invite is
      // accepted. Best-effort: a failed avatar upload shouldn't undo the invite.
      if (avatarFile) {
        try {
          await fetch(`${apiBase}/avatar`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email: trimmed,
              contents: await encodeAvatar(avatarFile),
              contentType: avatarFile.type,
            }),
          });
        } catch {
          // ignore - the invitee can set an avatar later
        }
      }
      toastQueue.positive(
        stringFormatter.format('userInvitedToast', { email: trimmed })
      );
      router.push(`${basePath}/users`);
    } finally {
      setSubmitting(false);
    }
  }

  const breadcrumbs = [
    {
      key: 'users',
      label: stringFormatter.format('userManagement'),
      href: `${basePath}/users`,
    },
    { key: 'current', label: stringFormatter.format('addUserAction') },
  ];

  return (
    <PageRoot>
      <PageHeader>
        <HeaderBreadcrumbs items={breadcrumbs} />
        <Button
          form={CREATE_FORM_ID}
          type="submit"
          marginStart="auto"
          prominence="high"
          isPending={isSubmitting}
        >
          {stringFormatter.format('addUserAction')}
        </Button>
      </PageHeader>
      <PageBody isScrollable>
        <Flex
          id={CREATE_FORM_ID}
          elementType="form"
          onSubmit={event => {
            event.preventDefault();
            onCreate();
          }}
          direction="column"
          gap="xlarge"
          maxWidth="scale.4600"
        >
          <TextField
            label={stringFormatter.format('emailLabel')}
            type="email"
            value={email}
            onChange={value => {
              setEmail(value);
              setEmailError(undefined);
            }}
            errorMessage={emailError}
            autoFocus
            isRequired
          />
          <AvatarField
            email={email.trim() || undefined}
            name={profileDisplayName(state, email.trim() || '?')}
            initialHasAvatar={false}
            deferUpload
            onFilePicked={setAvatarFile}
          />
          <FormValueContentFromPreviewProps
            {...previewProps}
            forceValidation={forceValidation}
          />
        </Flex>
      </PageBody>
    </PageRoot>
  );
}
