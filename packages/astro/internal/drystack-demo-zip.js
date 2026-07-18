import { buildDemoZipResponse } from '../src/demo-zip.ts';
// eslint-disable-next-line import/no-unresolved
import config from 'virtual:drystack-config';

export async function GET() {
  return buildDemoZipResponse(config);
}

export const prerender = true;
