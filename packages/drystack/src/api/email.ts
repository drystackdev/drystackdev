import { SendEmail } from './user-management';

// Structural subset of Cloudflare's Send Email binding - same reasoning as
// R2BucketLike/D1DatabaseLike in api-r2.ts/d1.ts: @drystack/core stays free
// of a workers-types dependency. Matches the simplified (non-MIME)
// env.EMAIL.send({to, from, subject, html, text}) shape - see
// plan/user-managent.md mục 7 / wrangler.jsonc's send_email binding.
export type EmailSenderBinding = {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
};

// Very small HTML->text fallback for the required `text` part - fine for
// the two templates this module actually sends (a paragraph and a link),
// not a general-purpose HTML sanitizer/renderer.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Undefined when either the binding or the from-address isn't configured -
// callers (user-management.ts's routes) already treat a missing sendEmail
// as "not set up yet" and fall back to showing a copyable link instead of
// failing the request.
export function makeCloudflareEmailSender(
  binding: EmailSenderBinding | undefined,
  fromAddress: string | undefined,
  fromName = 'drystack'
): SendEmail | undefined {
  if (!binding || !fromAddress) return undefined;
  return async ({ to, subject, html }) => {
    try {
      await binding.send({
        to,
        from: { email: fromAddress, name: fromName },
        subject,
        html,
        text: htmlToPlainText(html),
      });
      return true;
    } catch {
      return false;
    }
  };
}
