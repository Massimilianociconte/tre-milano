import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const cliPath = require.resolve('@lhci/cli/src/cli.js');
const chromePath = process.env.CHROME_PATH || chromium.executablePath();

try {
  await access(chromePath);
} catch {
  throw new Error(`Chromium non disponibile in ${chromePath}. Esegui: pnpm exec playwright install chromium`);
}

const child = spawn(process.execPath, [cliPath, 'autorun'], {
  cwd: process.cwd(),
  env: { ...process.env, CHROME_PATH: chromePath },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Lighthouse interrotto dal segnale ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
