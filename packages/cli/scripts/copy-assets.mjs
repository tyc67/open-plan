// Copies the schema and the format description into dist/assets, so the CLI does not read repository files at run time.
import { copyFile, mkdir } from 'node:fs/promises';

const docs = new URL('../../../docs/', import.meta.url), assets = new URL('../dist/assets/', import.meta.url);
await mkdir(assets, { recursive: true });
for (const name of ['open-plan.schema.json', 'plan-format.md']) await copyFile(new URL(name, docs), new URL(name, assets));
