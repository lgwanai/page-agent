import { afterEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { deliverEmail } from '../src/email.js';
vi.mock('nodemailer',()=>({default:{createTransport:vi.fn()}}));
afterEach(()=>vi.resetAllMocks());
const config={host:'smtp.example.com',port:587,secure:false,user:'user',password:'SECRET',from:'sender@example.com'};
const message={to:'receiver@example.com',subject:'截图',text:'正文',files:[{name:'截图.png',mimeType:'image/png',base64:'YWJj'}]};
describe('SMTP security',()=>{
  it('requires TLS and uses bytes rather than external files/URLs',async()=>{
    const sendMail=vi.fn().mockResolvedValue({messageId:'test',accepted:['receiver@example.com'],rejected:[]}),close=vi.fn();
    vi.mocked(nodemailer.createTransport).mockReturnValue({sendMail,close} as unknown as ReturnType<typeof nodemailer.createTransport>);
    expect(await deliverEmail(config,message)).toMatchObject({messageId:'test',attachmentCount:1});
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({requireTLS:true,tls:{rejectUnauthorized:true},disableFileAccess:true,disableUrlAccess:true}));
    expect(sendMail.mock.calls[0][0].attachments[0].content).toEqual(Buffer.from('abc'));expect(close).toHaveBeenCalledOnce();
  });
  it('rejects header injection without opening a connection',async()=>{
    await expect(deliverEmail(config,{...message,subject:'test\r\nBcc: other@example.com'})).rejects.toThrow('格式无效');expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
  it('does not expose credentials or automatically retry an uncertain send',async()=>{
    const sendMail=vi.fn().mockRejectedValue(new Error('SECRET transport failed')),close=vi.fn();
    vi.mocked(nodemailer.createTransport).mockReturnValue({sendMail,close} as unknown as ReturnType<typeof nodemailer.createTransport>);
    const error=await deliverEmail(config,message).catch(error=>error.message);expect(error).not.toContain('SECRET');expect(error).toContain('不要自动重发');expect(sendMail).toHaveBeenCalledOnce();
  });
});
