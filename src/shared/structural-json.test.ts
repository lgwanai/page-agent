import { expect, it } from 'vitest';
import { structuralJson } from './structural-json';
it('compares nested serialized objects independently of key order while preserving actual edits',()=>{
  expect(structuralJson({selector:'#save',attributes:{id:'save',name:'submit'},optional:undefined})).toBe(structuralJson({attributes:{name:'submit',id:'save'},selector:'#save'}));
  expect(structuralJson({nodes:[{id:1},{id:2}]})).not.toBe(structuralJson({nodes:[{id:2},{id:1}]}));
  expect(structuralJson({selector:'#save'})).not.toBe(structuralJson({selector:'#cancel'}));
});
