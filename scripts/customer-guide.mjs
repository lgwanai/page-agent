import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

export async function customerGuideFiles() {
  const html = await readFile(new URL('../docs/customer-portable-guide.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const main = dom.window.document.querySelector('main');
  main.querySelector('nav')?.remove();
  main.querySelectorAll('tr').forEach(row => {
    row.replaceWith(dom.window.document.createTextNode([...row.children].map(cell => cell.textContent.trim()).join(' | ') + '\n'));
  });
  main.querySelectorAll('li').forEach(item => item.prepend('• '));
  main.querySelectorAll('header,h1,h2,h3,p,li,pre,summary,details,footer,.note,.warning').forEach(element => element.append('\n\n'));
  const text = main.textContent.replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  dom.window.close();
  return { '客户使用说明.html': html, '客户使用说明.txt': '\ufeff' + text.replace(/\n/g, '\r\n') };
}

export async function writeCustomerGuide(directory) {
  for (const [name, data] of Object.entries(await customerGuideFiles())) await writeFile(join(directory, name), data, 'utf8');
}
