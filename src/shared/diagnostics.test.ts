import { describe, expect, it } from 'vitest';
import { diagnose, diagnosticError } from './diagnostics';

describe('agent diagnostics', () => {
  it('distinguishes disabled dates from missing selectors', () => {
    expect(diagnose(new Error('日期 2026-10-01 被页面禁用，不能选择'))).toMatchObject({code:'CALENDAR_DATE_DISABLED',phase:'verification',retryPolicy:'after_fix'});
  });
  it('identifies required inputs and safe configuration failures', () => {
    expect(diagnose(new Error('MCP JSON 缺少必填参数：name'))).toMatchObject({ code: 'INPUT_REQUIRED', phase: 'input', sideEffects: 'none', retryPolicy: 'after_fix' });
    expect(diagnose(new Error('AI Provider 未完整配置，请先填写 Base URL、Model 和 API Key'))).toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED', sideEffects: 'none' });
  });
  it('preserves inner frame details while adding outer node identity', () => {
    const error = diagnosticError(new Error('无法在当前页面定位节点'), { selector: '#name', actualFrameId: 23, actionDispatched: false });
    expect(diagnose(error, { nodeId: 'input1', actualFrameId: 0 })).toMatchObject({ code: 'SELECTOR_NOT_FOUND', sideEffects: 'none', context: { selector: '#name', actualFrameId: 23, nodeId: 'input1' } });
  });
  it('does not recommend automatic replay after transport uncertainty', () => {
    expect(diagnose(new Error('页面操作已发送，但响应中断，操作结果可能未知'))).toMatchObject({ code: 'EXECUTION_OUTCOME_UNKNOWN', sideEffects: 'possible', retryPolicy: 'inspect_before_retry' });
  });
  it('locates validation fields without including input data or secrets', () => {
    expect(diagnose(new Error('等待时长无效'), { phase: 'validation', path: 'nodes[2]', nodeId: 'wait1' })).toMatchObject({ code: 'WORKFLOW_INVALID', context: { field: 'durationMs', path: 'nodes[2].durationMs', nodeId: 'wait1' } });
  });
  it('reports calendar recovery as requiring inspection', () => {
    expect(diagnose(new Error('日历图标翻页方向错误且未能确认恢复'))).toMatchObject({ code: 'CALENDAR_SELECTION_FAILED', phase: 'verification', retryPolicy: 'inspect_before_retry', sideEffects: 'possible' });
  });
});
