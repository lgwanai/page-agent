import type { DataTableOutput, WorkflowFile } from '@/types/workflow';
import ExcelJS from 'exceljs';
export async function dataTableExcel(table: DataTableOutput, name: string): Promise<WorkflowFile> {
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('数据表');
  sheet.addRow(table.columns);
  for(const row of table.values)sheet.addRow(row);
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  sheet.columns.forEach(column=>{column.width=22;});
  if(table.columns.length)sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:table.columns.length}};
  const bytes=new Uint8Array(await workbook.xlsx.writeBuffer());
  if(bytes.byteLength>10*1024*1024)throw new Error('DataTable Excel 文件超过 10 MB');
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {name:`${name.replace(/[\\/:*?"<>|\r\n]/g,'_').replace(/\.xlsx$/i,'')||'数据表'}.xlsx`,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:btoa(binary)};
}
