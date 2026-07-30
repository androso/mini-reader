
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('../../.tmp/apps-mobile-test');
fs.mkdirSync(path.join(root, 'node_modules/expo'), { recursive: true });
fs.mkdirSync(path.join(root, 'node_modules/expo-secure-store'), { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(path.join(root, 'node_modules/expo/package.json'), JSON.stringify({ name: 'expo', type: 'module', exports: { './fetch': './fetch.js' } }));
fs.writeFileSync(path.join(root, 'node_modules/expo/fetch.js'), `
export const fetch = (...args) => {
  const impl = globalThis.__mobileTestExpoFetch;
  if (!impl) throw new Error('__mobileTestExpoFetch not set');
  return impl(...args);
};
`);
fs.writeFileSync(path.join(root, 'node_modules/expo-secure-store/package.json'), JSON.stringify({ name: 'expo-secure-store', type: 'module', main: './index.js' }));
fs.writeFileSync(path.join(root, 'node_modules/expo-secure-store/index.js'), `
const store = () => (globalThis.__mobileTestSecureStore ??= new Map());
export async function getItemAsync(key) { return store().get(key) ?? null; }
export async function setItemAsync(key, value) { store().set(key, value); }
export async function deleteItemAsync(key) { store().delete(key); }
`);
// Link workspace contracts for type-stripped runtime import
const contractsSrc = path.resolve('../../packages/contracts');
const contractsDest = path.join(root, 'node_modules/@reader/contracts');
fs.mkdirSync(path.join(root, 'node_modules/@reader'), { recursive: true });
try { fs.rmSync(contractsDest, { recursive: true, force: true }); } catch {}
fs.symlinkSync(contractsSrc, contractsDest, 'dir');
