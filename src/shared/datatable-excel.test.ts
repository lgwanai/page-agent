import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { dataTableExcel } from './datatable-excel';
describe('DataTable Excel',()=>{
  it('exports a genuine workbook, keeps numeric types and does not turn strings into formulas',async()=>{
    const file=await dataTableExcel({type:'datatable',columns:['金额','文字'],rows:[{金额:12.5,文字:'=1+1'}],values:[[12.5,'=1+1']],rowCount:1},'测试.xlsx');
    expect(file.name).toBe('测试.xlsx');
    const book=new ExcelJS.Workbook();await book.xlsx.load(Uint8Array.from(Buffer.from(file.base64,'base64')).buffer);
    expect(book.worksheets[0].getCell('A2').value).toBe(12.5);
    expect(book.worksheets[0].getCell('B2').value).toBe('=1+1');
    expect((book.worksheets[0].getRow(1).values as unknown[]).slice(1)).toEqual(['金额','文字']);
  });
});
