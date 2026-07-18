document.getElementById('optionsLink').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function updateStatus() {
  const statusEl = document.getElementById('status');
  try {
    const exists = await new Promise(r => chrome.storage.sync.get('apiKey', v => r(!!v.apiKey)));
    if (!exists) {
      statusEl.textContent = '⚠️ API key no configurada';
      statusEl.className = 'status error';
      return;
    }
    const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    statusEl.textContent = `✅ ${config.model}`;
    statusEl.className = 'status ok';
    const telEl = document.getElementById('telegramStatus');
    if (config.telegramEnabled && config.telegramToken && config.telegramChatId) {
      telEl.className = 'on';
    }
  } catch (err) {
    statusEl.textContent = `⚠️ ${err.message}`;
    statusEl.className = 'status error';
  }
}

document.getElementById('toggleChat').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const chat = document.getElementById('aipa-chat');
        if (chat) chat.classList.remove('aipa-minimized');
      }
    });
    window.close();
  } catch (err) {
    console.error(err);
  }
});

document.getElementById('captureBtn').addEventListener('click', async () => {
  const btn = document.getElementById('captureBtn');
  const lastQ = document.getElementById('lastQuestion');
  btn.textContent = 'Capturando...';
  btn.disabled = true;
  lastQ.style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_SCREENSHOT',
      tabId: tab.id
    });

    if (response && response.response) {
      lastQ.style.display = 'block';
      lastQ.textContent = `🤖 ${response.response.substring(0, 150)}...`;
      lastQ.style.borderColor = '#4f46e5';
      lastQ.style.color = '#4f46e5';
    } else if (response && response.error) {
      lastQ.style.display = 'block';
      lastQ.textContent = `❌ ${response.error}`;
      lastQ.style.borderColor = '#dc2626';
      lastQ.style.color = '#dc2626';
    }
  } catch (err) {
    lastQ.style.display = 'block';
    lastQ.textContent = `❌ ${err.message}`;
    lastQ.style.borderColor = '#dc2626';
    lastQ.style.color = '#dc2626';
  }

  btn.textContent = '📸 Capturar y analizar';
  btn.disabled = false;
});

document.getElementById('testTelegramBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testTelegramBtn');
  btn.textContent = 'Enviando...';
  btn.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'TEST_TELEGRAM' });
  if (result && result.ok) {
    btn.textContent = '✅ Enviado';
  } else {
    btn.textContent = `❌ ${result?.error || 'Error'}`;
  }
  setTimeout(() => {
    btn.textContent = '📨 Probar Telegram';
    btn.disabled = false;
  }, 3000);
});

updateStatus();
