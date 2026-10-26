import { repairLegacyTarget } from './legacy-target';
import { prepareUpload, validateUpload, verifyUpload, releaseUpload, clearUploadTargets } from './upload';
import { CONTENT_VERSION } from '@/shared/release';
import type { RuntimeMessage } from '@/types/messages';
import { executeEvent, resolveSemanticTarget } from './executor';
import { startSelecting, stopSelecting } from './selector';
import { isRecording, startRecording, stopRecording } from './recorder';
import { queryDom } from './query';
import { readOutputDom } from './output';
import { selectCalendarDate } from './calendar';
import { navigatePagination, readPagination } from './pagination';
import { locateEventTarget } from './target-locator';
import { inspectPage } from './inspect';
import { restoreScreenshot, screenshotControl } from './screenshot';
import { pickScreenshotRegion, cancelRegionPicker } from './region-picker';
import { readDataTable } from './datatable';
import { fillTable } from './table-fill';

interface ContentInstallation { version: string; alive?: () => boolean; dispose: () => void }
const contentWindow = window as Window & { __pageAgentLoaded?: boolean; __pageAgentInstallation?: ContentInstallation };

function waitForDocument(): Promise<void> {
  if (document.documentElement) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    });
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('页面加载超时')); }, 5000);
    observer.observe(document, { childList: true });
  });
}

const installation = contentWindow.__pageAgentInstallation;
let alive = false;
try { alive = installation?.alive?.() === true; } catch { /* invalidated extension context */ }
if (installation?.version !== CONTENT_VERSION || !alive) {
  try { installation?.dispose(); } catch { console.warn('[page-agent] 正在替换失效的页面脚本'); }
  const installedRuntime = chrome.runtime;
  contentWindow.__pageAgentLoaded = true;
  let recordingStartedAt: number | null = null;
  const pendingEvents = new Set<Promise<void>>();
  let recordingError: string | undefined;
  let recordingRevision = 0;
  let disposed = false;
  let stoppedStartedAt: number | null = null;

  const beginRecording = async (message: Extract<RuntimeMessage, { type: 'PAGE_AGENT_RECORDING_START_V2' }>, revision: number) => {
    await waitForDocument();
    if (disposed || revision !== recordingRevision || (stoppedStartedAt !== null && message.startedAt <= stoppedStartedAt)) return;
    if (recordingStartedAt === message.startedAt && isRecording()) return;
    stopSelecting();
    recordingStartedAt = message.startedAt;
    recordingError = undefined;
    startRecording(
      (event) => {
        const task = chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RECORD_EVENT', startedAt: message.startedAt, event })
          .then((response: { ok?: boolean; error?: string } | undefined) => {
            if (!response?.ok) throw new Error(response?.error ?? '录制操作未保存');
          })
          .catch((error: Error) => { recordingError = error.message; });
        pendingEvents.add(task);
        void task.finally(() => pendingEvents.delete(task));
      },
      () => { void chrome.runtime.sendMessage({ type: 'PAGE_AGENT_STOP_RECORDING_REQUEST' }).catch(() => undefined); },
      message.showOverlay,
    );
  };

  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message: RuntimeMessage, _sender, sendResponse) => {
    // Resolve captured semantics once for every target-based operation, then pass
    // an exact CSS handle to existing executors. Release it with the response.
    const captured = message as RuntimeMessage & { selector?: string; targetHint?: import('@/types/workflow').RecordedTargetHint };
    if (message.type !== 'PAGE_AGENT_LOCATE_SELECTOR' && captured.selector && captured.targetHint?.locator?.selector === captured.selector) {
      try {
        const element = locateEventTarget(captured.selector, captured.targetHint);
        if (!element) throw new Error('节点不存在或身份已改变');
        const attribute = 'data-page-agent-resolved-' + crypto.randomUUID();
        element.setAttribute(attribute, '');
        const originalResponse = sendResponse;
        const timer = setTimeout(() => element.removeAttribute(attribute), 120_000);
        sendResponse = response => { clearTimeout(timer); element.removeAttribute(attribute); originalResponse(response); };
        message = { ...message, selector: '[' + attribute + ']', targetHint: undefined } as RuntimeMessage;
      } catch (error) { sendResponse({ ok: false, error: (error as Error).message }); return false; }
    }
    if (message.type === 'PAGE_AGENT_REPAIR_TARGET') {
      try { const target = repairLegacyTarget(message.target); sendResponse({ ok: true, targetUpgrade: 1, target }); }
      catch (error) { sendResponse({ ok: false, targetUpgrade: 1, error: (error as Error).message }); }
      return false;
    }
    if (message.type === 'PAGE_AGENT_FILL_TABLE') {
      void fillTable(message.selector, message.data, message.keyColumns, message.skipUnmatchedRows, message.structure)
        .then(data => sendResponse({ ok: true, data }))
        .catch((error: Error & { report?: unknown }) => sendResponse({ ok: false, error: error.message, report: error.report }));
      return true;
    }
    if(message.type==='PAGE_AGENT_READ_DATATABLE'){
      try{sendResponse({ok:true,data:readDataTable(message.selector,message.header,message.parseNumbers)});}catch(error){sendResponse({ok:false,error:(error as Error).message});}
      return false;
    }
    if (message.type === 'PAGE_AGENT_PICK_SCREENSHOT_REGION') {
      stopSelecting();
      void pickScreenshotRegion().then((result)=>sendResponse({ok:true,result})).catch((error:Error)=>sendResponse({ok:false,error:error.message}));
      return true;
    }
    if (message.type === 'PAGE_AGENT_PAGINATION') {
      if (message.page === undefined) {
        try { sendResponse({ ok: true, data: readPagination(message.selector) }); }
        catch (error) { sendResponse({ ok: false, error: (error as Error).message }); }
      } else {
        void navigatePagination(message.selector, message.page, message)
          .then(({ output, verification }) => sendResponse({ ok: true, data: output, verification }))
          .catch((error: Error & { verification?: unknown }) => sendResponse({ ok: false, error: error.message, verification: error.verification }));
      }
      return true;
    }
    if (message.type === 'PAGE_AGENT_SCREENSHOT_CONTROL') {
      void screenshotControl(message).then(sendResponse).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === 'PAGE_AGENT_INSPECT_PAGE') {
      try { sendResponse(inspectPage(message.selector, message.maxNodes, message.maxText)); }
      catch (error) { sendResponse({ ok: false, error: (error as Error).message }); }
      return false;
    }
    if (message.type === 'PAGE_AGENT_PING') {
      sendResponse({ ok: true, href: location.href, title: document.title, frameLocator: true, targetUpgrade: 1, contentVersion: CONTENT_VERSION });
      return false;
    }
    if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') {
      try { sendResponse({ ok: true, count: message.targetHint ? (locateEventTarget(message.selector, message.targetHint) ? 1 : 0) : document.querySelectorAll(message.selector).length }); }
      catch (error) { sendResponse({ ok: false, error: (error as Error).message }); }
      return false;
    }
    if (message.type === 'PAGE_AGENT_START_SELECT') {
      startSelecting((target) => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_SELECTED', target }).catch(() => undefined), message.exactElement);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PAGE_AGENT_STOP_SELECT') {
      stopSelecting();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PAGE_AGENT_RECORDING_START_V2') {
      void beginRecording(message, ++recordingRevision)
        .then(() => sendResponse({ ok: true, recording: isRecording(), startedAt: message.startedAt }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === 'PAGE_AGENT_RECORDING_STOP_V2') {
      recordingRevision += 1;
      stoppedStartedAt = Math.max(stoppedStartedAt ?? 0, message.startedAt);
      if (recordingStartedAt === message.startedAt) {
        stopRecording();
        recordingStartedAt = null;
      }
      void Promise.all([...pendingEvents]).then(() => sendResponse({ ok: !recordingError, error: recordingError }));
      return true;
    }
    if (message.type === 'PAGE_AGENT_PREPARE_UPLOAD') {
      try { sendResponse({ ok: true, data: prepareUpload(message.selector) }); }
      catch (error) { sendResponse({ ok: false, error: (error as Error).message }); }
      return false;
    }
    if (message.type === 'PAGE_AGENT_VALIDATE_UPLOAD' || message.type === 'PAGE_AGENT_VERIFY_UPLOAD') {
      try { sendResponse({ ok: true, data: message.type === 'PAGE_AGENT_VALIDATE_UPLOAD' ? validateUpload(message.token, message.files) : verifyUpload(message.token, message.files) }); }
      catch (error) { sendResponse({ ok: false, error: (error as Error).message }); }
      return false;
    }
    if (message.type === 'PAGE_AGENT_RELEASE_UPLOAD') { releaseUpload(message.token); sendResponse({ ok: true }); return false; }
    if (message.type === 'PAGE_AGENT_READ_OUTPUT') {
      try { sendResponse({ ok: true, data: readOutputDom(message.selector, message.read, message.attributeName, message.multiple) }); }
      catch (error) { sendResponse({ ok: false, error: (error as Error).message }); }
      return false;
    }
    if (message.type === 'PAGE_AGENT_EXECUTE_EVENT') {
      let matched: Element | null;
      try { matched = locateEventTarget(message.selector, message.targetHint); }
      catch (error) { sendResponse({ ok: false, error: (error as Error).message }); return false; }
      const element = matched instanceof HTMLElement ? matched : undefined;
      if (!element) {
        sendResponse({ ok: false, error: matched ? `Selector 命中的节点不是可操作的 HTML 元素：${message.selector}` : `节点不存在：${message.selector}` });
        return false;
      }
      void executeEvent(element, message.event)
        .then(({ output, verification }) => sendResponse({ ok: verification.ok, data: output, verification, error: verification.ok ? undefined : verification.summary }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === 'PAGE_AGENT_SELECT_DATE') {
      void selectCalendarDate(message.selector, message.date, message.endDate)
        .then(({ output, verification }) => sendResponse({ ok: verification.ok, data: output, verification }))
        .catch((error) => sendResponse({ ok: false, error: (error as Error).message, verification: (error as Error & { verification?: unknown }).verification }));
      return true;
    }
    if (message.type === 'PAGE_AGENT_EXECUTE_AI') {
      try {
        const element = resolveSemanticTarget(message.instruction, message.scopeSelector);
        void executeEvent(element, message.event)
          .then(({ output, verification }) => sendResponse({ ok: verification.ok, data: output, verification, selector: element.tagName.toLowerCase(), text: element.innerText?.slice(0, 120), error: verification.ok ? undefined : verification.summary }))
          .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
      return true;
    }
    if (message.type === 'PAGE_AGENT_QUERY_DOM') {
      try { sendResponse({ ok: true, data: queryDom(message.selector, message.query) }); }
      catch (error) { sendResponse({ ok: false, error: (error as Error).message }); }
      return false;
    }
    if (message.type === 'PAGE_AGENT_READ_SELECTOR') {
      try {
        const elements = message.multiple
          ? [...document.querySelectorAll<HTMLElement>(message.selector)]
          : [document.querySelector<HTMLElement>(message.selector)].filter(Boolean) as HTMLElement[];
        if (!elements.length) throw new Error(`输入 selector 不存在：${message.selector}`);
        const values = elements.map((element) => {
          const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
            ? element.value : undefined;
          const attributes = Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value]));
          if (message.attribute === 'value') return value ?? '';
          if (message.attribute === 'html') return element.innerHTML;
          if (message.attribute === 'attributes') return attributes;
          return (element.innerText || element.textContent || value || '').trim();
        });
        sendResponse({ ok: true, data: message.multiple ? values : values[0], count: values.length });
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
      return false;
    }
    return false;
  };
  const syncRecording = () => {
    const revision = ++recordingRevision;
    void chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RECORDING_READY' })
      .then((response: { result?: RuntimeMessage | null } | undefined) => {
        if (disposed || revision !== recordingRevision) return;
        if (response?.result?.type === 'PAGE_AGENT_RECORDING_START_V2') return beginRecording(response.result, revision);
        // A BFCache document can return after recording was stopped on another page.
        if (response?.result === null) { stopRecording(); recordingStartedAt = null; }
      })
      .catch(() => undefined);
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('pageshow', syncRecording);
  document.addEventListener('DOMContentLoaded', syncRecording);
  contentWindow.__pageAgentInstallation = {
    version: CONTENT_VERSION,
    alive: () => Boolean(installedRuntime.id) && !disposed,
    dispose: () => {
      cancelRegionPicker();
      disposed = true; clearUploadTargets();
      recordingRevision += 1;
      window.removeEventListener('pageshow', syncRecording);
      document.removeEventListener('DOMContentLoaded', syncRecording);
      try { installedRuntime.onMessage.removeListener(listener); } catch { /* previous extension context is gone */ }
      stopRecording();
      stopSelecting();
      restoreScreenshot();
    },
  };
  // Every new document (including iframes) rejoins the current recording before load completes.
  syncRecording();
}
