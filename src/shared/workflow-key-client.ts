/** All key mutations run in the background, sharing one serialization queue. */
async function key(workflowId: string, rotate = false): Promise<string> {
  const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_WORKFLOW_KEY', workflowId, rotate });
  if (!response?.ok || typeof response.result !== 'string') throw new Error(response?.error ?? '无法读取工作流密钥');
  return response.result;
}
export const ensureWorkflowKey = (id: string) => key(id);
export const rotateWorkflowKey = (id: string) => key(id, true);
