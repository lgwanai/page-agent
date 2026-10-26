// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readDataTable } from './datatable';
afterEach(()=>{document.body.innerHTML='';});
describe('DOM DataTable',()=>{
  it('creates typed rows, preserving identifiers and safe text',()=>{
    document.body.innerHTML='<table><thead><tr><th>编号</th><th>金额</th><th>备注</th></tr></thead><tbody><tr><td>0012</td><td>12.5</td><td>=1+1<script>secret</script></td></tr></tbody></table>';
    expect(readDataTable('table','auto',true)).toMatchObject({columns:['编号','金额','备注'],rows:[{编号:'0012',金额:12.5,备注:'=1+1'}],rowCount:1});
    expect(()=>readDataTable('td','auto',true)).toThrow('唯一匹配');
  });
  it('expands row and column spans and joins multi-row headers',()=>{
    document.body.innerHTML='<table><thead><tr><th rowspan="2">地区</th><th colspan="2">销量</th></tr><tr><th>本月</th><th>上月</th></tr></thead><tbody><tr><td rowspan="2">上海</td><td>10</td><td>8</td></tr><tr><td>12</td><td>9</td></tr></tbody></table>';
    expect(readDataTable('table','auto',true)).toMatchObject({columns:['地区','销量 / 本月','销量 / 上月'],values:[['上海',10,8],['上海',12,9]]});
  });
  it('uses unique column names and supports explicit first row / no header',()=>{
    document.body.innerHTML='<table><tr><td>名称</td><td>名称</td><td></td></tr><tr><td>A</td><td>B</td></tr></table>';
    expect(readDataTable('table','firstRow',false)).toMatchObject({columns:['名称','名称_2','列3'],values:[['A','B','']]});
    expect(readDataTable('table','none',false).rowCount).toBe(2);
  });
  it('accepts a cell selector but refuses ambiguous table containers',()=>{
    document.body.innerHTML='<div id="wrap"><table><tr><td id="cell">abc</td></tr></table><table><tr><td>def</td></tr></table></div>';
    expect(readDataTable('#cell','none',false).values).toEqual([['abc']]);
    expect(()=>readDataTable('#wrap','auto',false)).toThrow('多个表格');
  });
  it('does not mix nested tables into outer table values',()=>{
    document.body.innerHTML='<table id="outer"><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>';
    expect(readDataTable('#outer','none',false).values).toEqual([['outer']]);
  });
  it('bounds zero rowspan to its own table section',()=>{
    document.body.innerHTML='<table><thead><tr><th rowspan="0">名称</th><th>金额</th></tr></thead><tbody><tr><td>A</td><td>2</td></tr></tbody></table>';
    expect(readDataTable('table','auto',true).values).toEqual([['A',2]]);
  });
});
