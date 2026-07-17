import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function resolveNetlifyBuildEnvironment(input = process.env) {
  const siteMode = input.PUBLIC_SITE_MODE?.trim() || 'preview';
  const dataMode = input.PUBLIC_DATA_MODE?.trim() || 'fixture';
  const explicitSiteUrl = input.PUBLIC_SITE_URL?.trim();

  if (siteMode === 'production' && dataMode === 'gold' && !explicitSiteUrl) {
    throw new Error('Build Gold bloccato: PUBLIC_SITE_URL deve essere configurata esplicitamente.');
  }

  return {
    ...input,
    PUBLIC_SITE_MODE: siteMode,
    PUBLIC_DATA_MODE: dataMode,
    PUBLIC_SITE_URL: explicitSiteUrl
      || input.URL?.trim()
      || input.DEPLOY_PRIME_URL?.trim()
      || 'https://tre-milano.example',
  };
}

export function runNetlifyBuild(input = process.env) {
  const env = resolveNetlifyBuildEnvironment(input);
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['run', 'build'], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.exitCode = runNetlifyBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Build Netlify non avviato.');
    process.exitCode = 1;
  }
}
