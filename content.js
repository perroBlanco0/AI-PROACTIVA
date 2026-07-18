let chatWidget = null;
let debounceTimer = null;
let lastUrl = '';
let isProcessing = false;
let isInitialized = false;
let conversationHistory = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatHistory() {
  if (conversationHistory.length === 0) return '';
  return conversationHistory.map(msg => {
    const role = msg.role === 'user' ? 'Usuario' : 'Asistente';
    return `${role}: ${msg.content}`;
  }).join('\n\n');
}

function createChatWidget() {
  if (chatWidget) return;

  chatWidget = document.createElement('div');
  chatWidget.id = 'aipa-chat';
  chatWidget.innerHTML = `
    <div id="aipa-chat-header">
      <div id="aipa-chat-agent">
        <span id="aipa-chat-avatar">🤖</span>
        <div>
          <div id="aipa-chat-name">Agente IA</div>
          <div id="aipa-chat-status">Iniciando...</div>
        </div>
      </div>
      <div id="aipa-chat-actions">
        <button id="aipa-chat-minimize" title="Minimizar">─</button>
        <button id="aipa-chat-close" title="Cerrar">✕</button>
      </div>
    </div>
    <div id="aipa-chat-messages"></div>
    <div id="aipa-chat-suggestions"></div>
    <div id="aipa-chat-input-area">
      <input type="text" id="aipa-chat-input" placeholder="Escribe un mensaje..." autocomplete="off">
      <button id="aipa-chat-send" title="Enviar">➤</button>
    </div>
  `;

  document.body.appendChild(chatWidget);

  document.getElementById('aipa-chat-close').addEventListener('click', () => {
    chatWidget.remove();
    chatWidget = null;
    isInitialized = false;
    conversationHistory = [];
  });

  document.getElementById('aipa-chat-minimize').addEventListener('click', () => {
    chatWidget.classList.toggle('aipa-minimized');
  });

  document.querySelector('#aipa-chat-header').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (chatWidget.classList.contains('aipa-minimized')) {
      chatWidget.classList.remove('aipa-minimized');
    }
  });

  document.getElementById('aipa-chat-send').addEventListener('click', sendUserMessage);
  document.getElementById('aipa-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendUserMessage();
  });

  let autoMinimizeTimer = null;
  chatWidget.addEventListener('mouseleave', () => {
    if (chatWidget.classList.contains('aipa-minimized')) return;
    autoMinimizeTimer = setTimeout(() => {
      chatWidget.classList.add('aipa-minimized');
    }, 2000);
  });
  chatWidget.addEventListener('mouseenter', () => {
    if (autoMinimizeTimer) {
      clearTimeout(autoMinimizeTimer);
      autoMinimizeTimer = null;
    }
  });
}

function addMessage(text, type = 'agent') {
  const container = document.getElementById('aipa-chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `aipa-msg aipa-msg-${type}`;

  if (type === 'agent') {
    msgDiv.innerHTML = `<span class="aipa-msg-avatar">🤖</span><div class="aipa-msg-bubble">${escapeHtml(text)}</div>`;
  } else {
    msgDiv.innerHTML = `<div class="aipa-msg-bubble">${escapeHtml(text)}</div>`;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function addTyping() {
  const container = document.getElementById('aipa-chat-messages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'aipa-msg aipa-msg-agent aipa-msg-typing';
  typingDiv.id = 'aipa-typing';
  typingDiv.innerHTML = `<span class="aipa-msg-avatar">🤖</span><div class="aipa-msg-bubble"><span class="aipa-dot">.</span><span class="aipa-dot">.</span><span class="aipa-dot">.</span></div>`;
  container.appendChild(typingDiv);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const typing = document.getElementById('aipa-typing');
  if (typing) typing.remove();
}

function setSuggestions(suggestions) {
  const container = document.getElementById('aipa-chat-suggestions');
  container.innerHTML = '';
  if (!suggestions || suggestions.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  suggestions.forEach(s => {
    const chip = document.createElement('button');
    chip.className = 'aipa-chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      document.getElementById('aipa-chat-input').value = s;
      sendUserMessage();
    });
    container.appendChild(chip);
  });
}

function setStatus(text, isError) {
  const el = document.getElementById('aipa-chat-status');
  if (el) {
    el.textContent = text;
    el.style.color = isError ? '#fca5a5' : 'rgba(255,255,255,0.8)';
  }
}

async function sendUserMessage() {
  const input = document.getElementById('aipa-chat-input');
  const text = input.value.trim();
  if (!text || isProcessing) return;

  input.value = '';
  isProcessing = true;
  setSuggestions([]);
  if (chatWidget) chatWidget.classList.remove('aipa-minimized');

  addMessage(text, 'user');
  addTyping();
  setStatus('Pensando...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_SCREENSHOT',
      query: text,
      history: formatHistory(),
      url: location.href,
      title: document.title
    });

    removeTyping();

    if (response && response.response) {
      addMessage(response.response, 'agent');
      setSuggestions(response.suggestions);
      setStatus('Listo');
      conversationHistory.push({ role: 'user', content: text });
      conversationHistory.push({ role: 'assistant', content: response.response });
    } else if (response && response.error) {
      addMessage(response.error, 'agent');
      setStatus('Error', true);
    }
  } catch (err) {
    removeTyping();
    addMessage(`Error de conexión: ${err.message}`, 'agent');
    setStatus('Error', true);
  }

  isProcessing = false;
}

async function triggerInitialAnalysis() {
  if (isProcessing) return;
  isProcessing = true;

  conversationHistory = [];
  setStatus('Capturando pantalla...');
  addTyping();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_SCREENSHOT',
      url: location.href,
      title: document.title
    });

    removeTyping();

    if (response && response.response) {
      addMessage(response.response, 'agent');
      setSuggestions(response.suggestions);
      setStatus('Listo');
      conversationHistory.push({ role: 'assistant', content: response.response });
    } else if (response && response.error) {
      addMessage(response.error, 'agent');
      setStatus('Error', true);
    }
  } catch (err) {
    removeTyping();
    addMessage(`Error de conexión: ${err.message}`, 'agent');
    setStatus('Error', true);
  }

  isProcessing = false;
  setTimeout(() => { if (chatWidget) chatWidget.classList.add('aipa-minimized'); }, 8000);
}

function debouncedAnalyze() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (config) => {
      if (config && config.autoAnalyze) {
        triggerInitialAnalysis();
      }
    });
  }, 1500);
}

function init() {
  if (isInitialized) return;
  isInitialized = true;

  lastUrl = location.href;
  conversationHistory = [];
  createChatWidget();
  chatWidget.classList.add('aipa-minimized');

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const old = document.getElementById('aipa-chat');
      if (old) old.remove();
      chatWidget = null;
      isInitialized = false;
      conversationHistory = [];
      setTimeout(init, 500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(debouncedAnalyze, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
