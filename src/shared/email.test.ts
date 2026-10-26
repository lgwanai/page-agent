import { describe, expect, it } from 'vitest';
import { prepareEmail } from './email';
const output={type:'files',files:[{name:'截图.png',mimeType:'image/png',base64:'YWJj'}]};
describe('email content',()=>{
  it('automatically attaches file-only body and preserves text body',()=>{
    expect(prepareEmail(output,[])).toEqual({text:'',files:output.files});
    expect(prepareEmail('结果',[output])).toEqual({text:'结果',files:output.files});
  });
  it('rejects text variables as attachments',()=>expect(()=>prepareEmail('正文',['文本'])).toThrow('附件变量'));
  it('limits attachment bytes',()=>expect(()=>prepareEmail('',[{type:'files',files:[{...output.files[0],base64:'a'.repeat(15*1024*1024)}]}])).toThrow('10 MB'));
});
