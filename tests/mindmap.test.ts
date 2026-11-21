import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateMindmap } from '../src/mindmap-model';
const read = (name: string) => JSON.parse(readFileSync(`fixtures/mindmap/${name}`, 'utf8'));
describe('mindmap fixtures', () => {
  for (const name of ['valid.json', 'valid-rich.json']) it(`accepts ${name}`, () => expect(() => validateMindmap(read(name))).not.toThrow());
  for (const {file, reason} of read('cases.json') as {file:string;reason:string}[]) it(`rejects ${file}`, () => expect(() => validateMindmap(read(file))).toThrow(reason));
});
