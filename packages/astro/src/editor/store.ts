// Moved to @drystack/core/edit-sync so the admin app and the visual editor
// share one implementation (plus the cross-tab BroadcastChannel bus). This
// re-export keeps existing imports in this package working unchanged.
export * from '@drystack/core/edit-sync';
