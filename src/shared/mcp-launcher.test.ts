import { describe, expect, it } from 'vitest';
import { nativeLauncherInstallCommand } from './mcp-launcher';
const id = 'abcdefghijklmnopabcdefghijklmnop';
describe('native launcher install commands', () => {
  it('quotes macOS shell metacharacters and uses the sibling launcher', () => {
    const command = nativeLauncherInstallCommand({ command: "/客户 A/o'neil/node", serverPath: '/客户/$HOME/`echo bad`/index.js' }, id, false);
    expect(command).toBe(`'/客户 A/o'\\''neil/node' '/客户/$HOME/\`echo bad\`/native-host.js' --install ${id}`);
  });
  it('uses literal PowerShell arguments for Windows paths', () => {
    expect(nativeLauncherInstallCommand({ command: 'node', serverPath: "C:\\客户 A\\o'neil\\index.js" }, id, true)).toBe(`& 'node' 'C:\\客户 A\\o''neil\\native-host.js' --install ${id}`);
  });
  it('rejects incomplete configuration and invalid IDs', () => {
    expect(() => nativeLauncherInstallCommand({ command: 'node', serverPath: '' }, id)).toThrow();
    expect(() => nativeLauncherInstallCommand({ command: 'node', serverPath: '/server/index.js' }, 'bad; command')).toThrow('插件 ID');
    expect(() => nativeLauncherInstallCommand({ command: 'node', serverPath: '/server/other.js' }, id)).toThrow('index.js');
  });
});
