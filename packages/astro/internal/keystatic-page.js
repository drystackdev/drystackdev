import { makePage } from '../src/ui.tsx';
// eslint-disable-next-line import/no-unresolved
import config from 'virtual:keystatic-config';
// eslint-disable-next-line import/no-unresolved
import path from 'virtual:keystatic-path';

export const Keystatic = makePage(config, `/${path}`);
