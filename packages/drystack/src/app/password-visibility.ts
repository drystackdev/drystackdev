import { create } from 'zustand';

type PasswordVisibilityStore = {
  visible: boolean;
  toggle: () => void;
};

// Shared across every SyncedPasswordField mounted at once (e.g. the profile
// page's old/new/confirm password fields) - toggling "show password" on any
// one of them reveals all of them together, rather than each field tracking
// its own hidden local state.
export const usePasswordVisibility = create<PasswordVisibilityStore>(set => ({
  visible: false,
  toggle: () => set(state => ({ visible: !state.visible })),
}));
