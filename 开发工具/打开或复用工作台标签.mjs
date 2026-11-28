import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CHROME_SCRIPT = `on run argv
  set targetURL to item 1 of argv
  set targetPrefix to targetURL & "/"
  set targetAuthority to text 8 thru -1 of targetURL
  tell application id "com.google.Chrome"
    set matchWindow to missing value
    set matchIndex to 0
    repeat with browserWindow in windows
      set tabIndex to 0
      repeat with browserTab in tabs of browserWindow
        set tabIndex to tabIndex + 1
        set tabURL to URL of browserTab
        if tabURL is targetURL or tabURL starts with targetPrefix then
          set matchWindow to browserWindow
          set matchIndex to tabIndex
          exit repeat
        end if
      end repeat
      if matchWindow is not missing value then exit repeat
    end repeat
    if matchWindow is not missing value then
      set active tab index of matchWindow to matchIndex
      set matchedTab to tab matchIndex of matchWindow
      set tabTitle to title of matchedTab
      if not (loading of matchedTab) and (tabTitle is "" or tabTitle is "localhost" or tabTitle is targetAuthority) then
        reload matchedTab
      end if
      set index of matchWindow to 1
      activate
      return "reused"
    end if
  end tell
  return "not-found"
end run`;

export async function 打开或复用工作台标签(address, {
  automateChrome = (script, url) => exec('/usr/bin/osascript', ['-e', script, url], { timeout: 15000 }),
  openURL = url => exec('/usr/bin/open', [url], { timeout: 15000 }),
} = {}) {
  try {
    const result = await automateChrome(CHROME_SCRIPT, address);
    if (result.stdout.trim() === 'reused') return { reused: true, address };
  } catch (error) {
    const detail = `${error.message || ''}\n${error.stderr || ''}`;
    if (/-1743|not authorized to send Apple events/i.test(detail)) {
      throw Error('macOS 尚未允许 AI-Workbench 控制 Google Chrome；请在“系统设置 > 隐私与安全性 > 自动化”允许后重试。');
    }
  }
  await openURL(address);
  return { reused: false, address };
}
