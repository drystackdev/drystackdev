import { makeHandler } from '../src/api.tsx';
// eslint-disable-next-line import/no-unresolved
import config from 'virtual:keystatic-config';
// eslint-disable-next-line import/no-unresolved
import basePath from 'virtual:keystatic-path';

export const all = makeHandler({ config, basePath });
export const ALL = all;

export const prerender = false;
