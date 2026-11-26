import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const required = [
  'index.html',
  'wasm/russian_roulette_wasm.js',
  'wasm/russian_roulette_wasm_bg.wasm',
];

for (const file of required) {
  await access(join(dist, file), constants.R_OK);
}

const wasm = await readFile(join(dist, 'wasm/russian_roulette_wasm_bg.wasm'));
if (wasm.subarray(0, 4).toString('hex') !== '0061736d') {
  throw new Error('The Pages artifact contains an invalid WASM binary.');
}

console.log('Pages artifact contains the Rust WASM entry point.');
