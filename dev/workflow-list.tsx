// Development-only visual fixture. No extension storage, credentials or business actions.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { WorkflowList } from '../src/sidepanel/App';
import { EMPTY_WORKSPACE } from '../src/shared/storage';
import type { ScriptDefinition } from '../src/types/workflow';
const names = ['天猫数据获取工作流', '分页与循环内部子流程验收（临时测试）', '抖音数据获取', '抖店日历调试（临时）', '小红书内容采集', '朋友圈素材整理', '电商价格监控', '数据清洗与入库'];
const scripts = names.map((name, index) => ({ id: `4ccfb46b-5849-4ecd-aa93-00ae59dd617${index}`, name, nodes: [], edges: [], description: index === 1 ? '只读 Query 与翻页；不生成报表、不修改业务数据' : '8 个节点 · 7 条连线' } as unknown as ScriptDefinition));
function Preview() {
  const [notice, setNotice] = useState('');
  const say = (text: string) => () => setNotice(text);
  return <main><WorkflowList state={{ ...EMPTY_WORKSPACE, scripts }} onRun={say('运行（预览）')} onCreate={say('创建工作流（预览）')} onEdit={say('编辑（预览）')} onImport={say('导入（预览）')} onExport={say('导出（预览）')} onCopyId={(workflow) => { void navigator.clipboard.writeText(workflow.id).then(say('工作流 ID 已复制')); }} onCopyKey={say('复制密钥（预览，无真实密钥）')} onCopyPrompt={say('复制运行 Prompt（预览）')} running={null} busy={false} lastRun={null} />{notice && <div className="toast">{notice}</div>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
