/** @jest-environment node */
import { expect, test } from '@jest/globals';
import { makeCloudflareEmailSender, makeResendEmailSender } from './email';

test('undefined binding or from-address means no sender at all', () => {
  const binding = { send: async () => ({}) };
  expect(makeCloudflareEmailSender(undefined, 'noreply@example.com')).toBeUndefined();
  expect(makeCloudflareEmailSender(binding, undefined)).toBeUndefined();
});

test('sends through the binding with the configured from-address, and a text fallback derived from the html', async () => {
  const calls: unknown[] = [];
  const binding = {
    send: async (message: unknown) => {
      calls.push(message);
      return {};
    },
  };
  const sendEmail = makeCloudflareEmailSender(binding, 'noreply@example.com', 'drystack')!;
  const ok = await sendEmail({
    to: 'user@example.com',
    subject: 'Hello',
    html: '<p>Click <a href="https://example.com/x">here</a>.</p>',
  });
  expect(ok).toBe(true);
  expect(calls).toEqual([
    {
      to: 'user@example.com',
      from: { email: 'noreply@example.com', name: 'drystack' },
      subject: 'Hello',
      html: '<p>Click <a href="https://example.com/x">here</a>.</p>',
      text: 'Click here (https://example.com/x).',
    },
  ]);
});

test('a send failure resolves to false instead of throwing', async () => {
  const binding = {
    send: async () => {
      throw new Error('boom');
    },
  };
  const sendEmail = makeCloudflareEmailSender(binding, 'noreply@example.com')!;
  expect(
    await sendEmail({ to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>' })
  ).toBe(false);
});

test('resend: undefined api key or from-address means no sender at all', () => {
  expect(makeResendEmailSender(undefined, 'noreply@example.com')).toBeUndefined();
  expect(makeResendEmailSender('re_xxx', undefined)).toBeUndefined();
});

test('resend: posts to the Resend API with the configured from-address, and a text fallback derived from the html', async () => {
  const calls: unknown[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, JSON.parse(init.body as string), init.headers]);
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    const sendEmail = makeResendEmailSender('re_xxx', 'noreply@example.com', 'drystack')!;
    const ok = await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Click <a href="https://example.com/x">here</a>.</p>',
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([
      [
        'https://api.resend.com/emails',
        {
          from: 'drystack <noreply@example.com>',
          to: 'user@example.com',
          subject: 'Hello',
          html: '<p>Click <a href="https://example.com/x">here</a>.</p>',
          text: 'Click here (https://example.com/x).',
        },
        { Authorization: 'Bearer re_xxx', 'Content-Type': 'application/json' },
      ],
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('resend: a non-ok response or thrown error resolves to false instead of throwing', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;
  try {
    const sendEmail = makeResendEmailSender('re_xxx', 'noreply@example.com')!;
    expect(
      await sendEmail({ to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    ).toBe(false);
  } finally {
    global.fetch = originalFetch;
  }

  global.fetch = (async () => {
    throw new Error('boom');
  }) as typeof fetch;
  try {
    const sendEmail = makeResendEmailSender('re_xxx', 'noreply@example.com')!;
    expect(
      await sendEmail({ to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    ).toBe(false);
  } finally {
    global.fetch = originalFetch;
  }
});
