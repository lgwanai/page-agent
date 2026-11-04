const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$('version').textContent = chrome.runtime.getManifest().version;
let selectedTab: number | undefined;
async function refresh() {
  const tabs = (await chrome.tabs.query({})).filter(tab => /^https?:/.test(tab.url ?? ''));
  const select = $<HTMLSelectElement>('tab'); select.replaceChildren();
  for (const tab of tabs) { const option = document.createElement('option'); option.value = String(tab.id); option.textContent = `${tab.title} · ${tab.url}`; select.append(option); }
  const douyin = tabs.find(tab => tab.url?.startsWith('https://live.douyin.com/'));
  if (douyin?.id) select.value = String(douyin.id);
}
async function request(operation: string) {
  selectedTab = Number($<HTMLSelectElement>('tab').value) || undefined;
  const result = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_RECORDING', operation, tabId: selectedTab, options: {mode:$<HTMLSelectElement>('mode').value,fileName:'抖音直播实测',durationMs:Number($<HTMLInputElement>('duration').value)*1000} });
  $('status').textContent = JSON.stringify(result, null, 2);
  return result;
}
$('start').onclick = () => { void request('start'); };
$('stop').onclick = () => { void request('stop'); };
$('refresh').onclick = () => { void refresh(); };
setInterval(() => { void request('status'); }, 2000);
void refresh();
