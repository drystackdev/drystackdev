import { expect, test } from "@jest/globals";
import { appendRedirect, serializeRedirectsFile } from "./redirects";

test("a→b then b→c collapses to a single hop, not a chain", () => {
  let entries = appendRedirect([], { from: "/bai-viet-1", to: "/doi-ten-1" });
  entries = appendRedirect(entries, { from: "/doi-ten-1", to: "/doi-ten-2" });

  expect(entries).toEqual([
    expect.objectContaining({ from: "/bai-viet-1", to: "/doi-ten-2" }),
    expect.objectContaining({ from: "/doi-ten-1", to: "/doi-ten-2" }),
  ]);
});

test("a three-hop rename still collapses every hop to the final destination", () => {
  let entries = appendRedirect([], { from: "/a", to: "/b" });
  entries = appendRedirect(entries, { from: "/b", to: "/c" });
  entries = appendRedirect(entries, { from: "/c", to: "/d" });

  expect(entries.map((e) => [e.from, e.to]).sort()).toEqual([
    ["/a", "/d"],
    ["/b", "/d"],
    ["/c", "/d"],
  ]);
});

test("reusing an old URL as a live page drops the stale redirect out of it", () => {
  // /a was renamed to /b, then a *new* entry is published back at /a.
  let entries = appendRedirect([], { from: "/a", to: "/b" });
  entries = appendRedirect(entries, { from: "/c", to: "/a" });

  // the redirect out of /a must be gone - otherwise it would shadow the
  // freshly-published page now living there.
  expect(entries.find((e) => e.from === "/a")).toBeUndefined();
  expect(entries).toEqual([expect.objectContaining({ from: "/c", to: "/a" })]);
});

test("renaming back to the original slug redirects the abandoned intermediate name forward, not backward", () => {
  // /a was renamed to /b (redirect /a→/b), then renamed back to /a. /b was
  // briefly the live published URL and may be indexed/linked externally, so
  // it must still redirect - to wherever the content lives now (/a) - while
  // /a itself, being live again, must not carry a stale outgoing redirect.
  let entries = appendRedirect([], { from: "/a", to: "/b" });
  entries = appendRedirect(entries, { from: "/b", to: "/a" });

  expect(entries).toEqual([expect.objectContaining({ from: "/b", to: "/a" })]);
});

test("trailing slashes are normalized so they compare equal", () => {
  const entries = appendRedirect([], { from: "/a/", to: "/b" });
  expect(entries).toEqual([expect.objectContaining({ from: "/a", to: "/b" })]);
});

test("appending an already-redirected destination stays flat (idempotent-ish)", () => {
  // Deleting entry A with a redirect to B, then later deleting B with a
  // redirect to C, must not leave A pointing at dead B.
  let entries = appendRedirect([], { from: "/a", to: "/b" });
  entries = appendRedirect(entries, { from: "/b", to: "/c" });
  entries = appendRedirect(entries, { from: "/x", to: "/y" });

  expect(entries.map((e) => [e.from, e.to]).sort()).toEqual([
    ["/a", "/c"],
    ["/b", "/c"],
    ["/x", "/y"],
  ]);
});

test("serializeRedirectsFile renders Cloudflare `_redirects` lines with 301", () => {
  const entries = appendRedirect([], { from: "/old", to: "/new" });
  expect(serializeRedirectsFile(entries)).toBe("/old /new 301");
});

test("serializeRedirectsFile drops self-redirects and dedupes sources", () => {
  const body = serializeRedirectsFile([
    { from: "/a", to: "/a" },
    { from: "/b", to: "/c" },
    { from: "/b", to: "/d" },
  ]);
  expect(body).toBe("/b /c 301");
});
