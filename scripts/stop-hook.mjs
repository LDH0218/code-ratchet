#!/usr/bin/env node
import { runHookCli } from '../src/hook.mjs';

const idx = process.argv.indexOf('--harness');
const explicit = idx !== -1 ? process.argv[idx + 1] : undefined;
runHookCli(explicit);
