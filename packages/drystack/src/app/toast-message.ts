const MAX_TOAST_MESSAGE_LENGTH = 300;

// Error text handed to a toast comes from the network (GitHub, Cloudflare,
// the AI provider) with no length contract - left unbounded, a long payload
// (a stack trace, an HTML error page) blows out the toast's fixed-width box
// instead of wrapping.
export function truncateToastMessage(
  message: string,
  max = MAX_TOAST_MESSAGE_LENGTH,
): string {
  return message.length > max ? `${message.slice(0, max)}...` : message;
}
