/**
 * The rewrite route asks for a bare HTML fragment, but a prompt is not a
 * guarantee: models reach for a ```html fence out of habit. The fence would
 * otherwise reach the parser and land in the document as literal backticks.
 *
 * Only a fence wrapping the *whole* answer is stripped. A fence in the middle
 * is the model writing about code, which the passage may legitimately contain.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const firstNewline = trimmed.indexOf("\n");
  // A fence with no body ("```html") carries no content at all.
  if (firstNewline === -1) return "";

  const openingLine = trimmed.slice(0, firstNewline).trim();
  // ```html and ``` open a fragment; ```js does not - that's a code sample the
  // answer happens to start with, and its fence is part of the content.
  if (!/^```(html)?$/i.test(openingLine)) return trimmed;

  const rest = trimmed.slice(firstNewline + 1);
  const closing = rest.lastIndexOf("```");
  // An unterminated fence still means the body was meant as the answer - the
  // model just ran out of tokens before closing it.
  if (closing === -1) return rest.trim();
  return rest.slice(0, closing).trim();
}
