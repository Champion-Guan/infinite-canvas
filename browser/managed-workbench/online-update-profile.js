// Only a profile/session witness. No keys, prompts, files or canvas content.
// Registration is unavailable in old releases and cannot itself grant install.
if (window.top === window && ['http://localhost:8888', 'http://127.0.0.1:8888'].includes(location.origin)
  && !location.pathname.startsWith('/online-migration-')) {
  const register = async () => {
    try {
      const value = await chrome.runtime.sendMessage({ op: 'guan-online-update-profile' });
      if (!value) return;
      await fetch('/local-app/online-migration/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value), signal: AbortSignal.timeout(2000) });
    } catch { /* Missing bridge/profile never permits an unattended copy. */ }
  };
  void register();
  setInterval(() => { void register(); }, 10000);
}
