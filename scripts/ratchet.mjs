#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
export * from '../src/core.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('../bin/code-ratchet.mjs');
}
