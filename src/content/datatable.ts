import type { DataTableNode, DataTableOutput } from '@/types/workflow';

function text(cell: HTMLTableCellElement): string {
  const copy=cell.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('script,style,table,input[type="password"],input[type="hidden"]').forEach(node=>node.remove());
  return (copy.textContent??'').replace(/\s+/g,' ').trim();
}

export function readDataTable(selector: string, header: DataTableNode['header'], parseNumbers: boolean): DataTableOutput {
  if (!['auto','firstRow','none'].includes(header)) throw new Error('DataTable 表头配置无效');
  const roots=[...document.querySelectorAll(selector)];
  if(roots.length!==1)throw new Error(`DataTable Selector 需要唯一匹配，当前 ${roots.length} 个`);
  const root=roots[0];
  const candidates=root instanceof HTMLTableElement?[root]:root.closest('table')?[root.closest('table')!]:[...root.querySelectorAll('table')].filter(table=>!table.parentElement?.closest('table'));
  if(candidates.length!==1)throw new Error('DataTable 需要选中一个 table 或其单元格/唯一表格容器；不支持多个表格及纯 div 虚拟表格');
  const table=candidates[0];
  const rows=[...table.rows].filter(row=>row.closest('table')===table);
  if(!rows.length)throw new Error('DataTable 表格没有行');
  if(rows.length>5000)throw new Error('DataTable 超过 5000 行，请缩小范围或按页读取');
  const grid:string[][]=[];
  let cells=0;
  let characters=0;
  rows.forEach((row,r)=>{
    grid[r]??=[];let c=0;
    for(const cell of [...row.cells]){
      while(grid[r][c]!==undefined)c++;
      let sectionRows=1;while(r+sectionRows<rows.length&&rows[r+sectionRows].parentElement===row.parentElement)sectionRows++;
      const rowSpan=cell.rowSpan===0?sectionRows:Math.min(Math.max(1,cell.rowSpan),sectionRows);
      const colSpan=Math.max(1,cell.colSpan);
      if(c+colSpan>200||cells+rowSpan*colSpan>50000)throw new Error('DataTable 超过 200 列或 50000 个单元格');
      const value=text(cell);
      characters+=value.length*rowSpan*colSpan;
      if(value.length>32767||characters>5*1024*1024)throw new Error('DataTable 单元格文字过长或数据超过 5 MB');
      for(let y=r;y<r+rowSpan;y++){
        grid[y]??=[];
        for(let x=c;x<c+colSpan;x++){
          if(grid[y][x]!==undefined)throw new Error('DataTable 合并单元格重叠，无法安全转换');
          grid[y][x]=value;cells++;
        }
      }
      c+=colSpan;
    }
  });
  const width=Math.max(...grid.map(row=>row.length));
  let headerRows=0;
  if(header==='firstRow')headerRows=1;
  if(header==='auto'){
    while(headerRows<rows.length&&rows[headerRows].parentElement?.tagName==='THEAD')headerRows++;
    if(!headerRows&&[...rows[0].cells].every(cell=>cell.tagName==='TH')&&rows[0].cells.length)headerRows=1;
  }
  const used=new Set<string>();
  const columns=Array.from({length:width},(_,c)=>{
    const parts=grid.slice(0,headerRows).map(row=>row[c]??'').filter((part,index,array)=>part&&array.indexOf(part)===index);
    const base=parts.join(' / ')||`列${c+1}`;
    let name=base,index=2;while(used.has(name))name=`${base}_${index++}`;
    used.add(name);return name;
  });
  const values=grid.slice(headerRows).map(row=>columns.map((_,c)=>{
    const value=row[c]??'';
    // Preserve IDs with leading zeroes and long integer identifiers.
    if(parseNumbers&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&value.replace(/[-.]/g,'').length<=15&&Number.isFinite(Number(value)))return Number(value);
    return value;
  }));
  return {type:'datatable',columns,values,rows:values.map(row=>Object.fromEntries(columns.map((name,c)=>[name,row[c]]))),rowCount:values.length};
}
