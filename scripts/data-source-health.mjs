import { cliOption, createDataClient, loadDataEnv } from './data-lib.mjs';

async function main() {
  const client = createDataClient(await loadDataEnv(cliOption('env')));
  const result = await client.rpc('catalog_maintenance', {});
  console.info(JSON.stringify({ status: 'ok', maintenance: result }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
