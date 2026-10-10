import { describe, expect, it } from 'vitest';
import { parseRunInputs } from './RunInputs';
import type { StartInputDeclaration, StartInputType } from '@/types/workflow';

const field = (type: StartInputType, required = true): StartInputDeclaration => ({ id: 'i', name: 'value', type, required });
describe('manual run parameter validation', () => {
  it('preserves text and converts numbers including zero', () => {
    expect(parseRunInputs([field('string')], { i: ' abc ' })).toEqual({ value: ' abc ' });
    expect(parseRunInputs([field('number')], { i: '0' })).toEqual({ value: 0 });
  });
  it('accepts lists, objects and object lists', () => {
    expect(parseRunInputs([field('array')], { i: '[1,"a"]' })).toEqual({ value: [1, 'a'] });
    expect(parseRunInputs([field('object')], { i: '{"a":1}' })).toEqual({ value: { a: 1 } });
    expect(parseRunInputs([field('objectArray')], { i: '[{"a":1}]' })).toEqual({ value: [{ a: 1 }] });
  });
  it('rejects missing required values, malformed JSON and wrong types', () => {
    expect(() => parseRunInputs([field('string')], {})).toThrow('必填');
    expect(() => parseRunInputs([field('number')], { i: 'Infinity' })).toThrow('数字');
    expect(() => parseRunInputs([field('object')], { i: '{' })).toThrow('JSON');
    expect(() => parseRunInputs([field('object')], { i: 'null' })).toThrow('对象');
    expect(() => parseRunInputs([field('objectArray')], { i: '[1]' })).toThrow('对象列表');
    expect(() => parseRunInputs([field('array')], { i: '[{"a":1}]' })).toThrow('列表');
  });
  it('omits blank optional fields and rejects duplicate names', () => {
    expect(parseRunInputs([field('number', false)], {})).toEqual({});
    expect(() => parseRunInputs([field('string'), { ...field('string'), id: 'j' }], { i: 'a', j: 'b' })).toThrow('重复');
  });
});
