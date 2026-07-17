import { expect, test } from "@jest/globals";
import {
  brandRefDisplayLabel,
  formatBrandRef,
  isBrandRef,
} from "./brand-label";

// The ref is timestamp-only on purpose: ownership is read off the tip commit's
// author (shell/data.tsx), never parsed back out of the branch name.
test("a brand ref carries the timestamp and nothing else", () => {
  const ref = formatBrandRef(undefined, new Date(2026, 6, 17, 17, 14, 29));
  expect(ref).toBe("drystack/2026-07-17-171429");
});

test("a login is never appended to the ref, whatever the config prefix", () => {
  const ref = formatBrandRef("brands/", new Date(2026, 6, 17, 17, 14, 29));
  expect(ref).toBe("brands/2026-07-17-171429");
});

test("two brands cut in the same second collide - callers must handle createRef failing", () => {
  const at = new Date(2026, 6, 17, 17, 14, 29);
  expect(formatBrandRef(undefined, at)).toBe(formatBrandRef(undefined, at));
});

test("single-digit months, days and times keep their zero padding", () => {
  const ref = formatBrandRef(undefined, new Date(2026, 0, 3, 4, 5, 6));
  expect(ref).toBe("drystack/2026-01-03-040506");
});

test("a brand ref renders as a day-first local timestamp", () => {
  expect(brandRefDisplayLabel("drystack/2026-07-17-171429", undefined)).toBe(
    "17/07/2026 17:14:29",
  );
});

test("the configured prefix is stripped, not the default one", () => {
  expect(brandRefDisplayLabel("brands/2026-07-17-171429", "brands/")).toBe(
    "17/07/2026 17:14:29",
  );
});

// A ref that isn't a brand still has to render: the default branch shows up in
// error/fallback paths, and useBrandGuard adopts hand-made branches as brands.
test("a non-brand ref is shown unchanged rather than mangled", () => {
  expect(brandRefDisplayLabel("main", undefined)).toBe("main");
});

test("a prefixed ref that isn't a timestamp keeps its name, minus the prefix", () => {
  expect(brandRefDisplayLabel("drystack/hotfix-login", undefined)).toBe(
    "hotfix-login",
  );
});

// The chip lists brands by asking this, so a default that drifts away from
// formatBrandRef's would silently empty the branch dropdown.
test("the refs formatBrandRef makes are recognised as brands under the same default", () => {
  const ref = formatBrandRef(undefined, new Date(2026, 6, 17, 17, 14, 29));
  expect(isBrandRef(ref, undefined)).toBe(true);
});

test("a custom prefix round-trips between formatBrandRef and isBrandRef", () => {
  const ref = formatBrandRef("brands/", new Date(2026, 6, 17, 17, 14, 29));
  expect(isBrandRef(ref, "brands/")).toBe(true);
});

test("branches outside the prefix are not brands", () => {
  expect(isBrandRef("main", undefined)).toBe(false);
  expect(isBrandRef("feature/login", undefined)).toBe(false);
});

// Round-tripping is what the chip actually does: generate a ref, then label it.
test("every ref formatBrandRef makes renders as a real timestamp", () => {
  const at = new Date(2026, 11, 31, 23, 59, 59);
  expect(brandRefDisplayLabel(formatBrandRef(undefined, at), undefined)).toBe(
    "31/12/2026 23:59:59",
  );
});
