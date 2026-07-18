const DEFAULT_CONFIG = {
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: '',
  model: 'gemini-2.0-flash',
  language: 'es',
  autoAnalyze: true,
  telegramEnabled: false,
  telegramToken: '',
  telegramChatId: '',
  systemPrompt: `Eres un asistente de IA integrado en el navegador del usuario. Tienes visión artificial.

Personalidad: directo, útil, sin rodeos. Sin saludos ni presentaciones.

Reglas:
1. Responde con 2-3 líneas máximas. Breve y al grano.
2. Considera el sitio web actual del usuario como contexto.
3. Sugiere 3 preguntas específicas al final, separadas por "||".
4. No saludes ni te presentes. Ve directo al punto.

Formato:
[Respuesta breve]

||Pregunta 1?||Pregunta 2?||Pregunta 3?`
};

async function loadConfig() {
  const result = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  const config = { ...DEFAULT_CONFIG, ...result };

  document.getElementById('apiEndpoint').value = config.apiEndpoint;
  document.getElementById('apiKey').value = config.apiKey;
  document.getElementById('model').value = config.model;
  document.getElementById('language').value = config.language;
  document.getElementById('autoAnalyze').checked = config.autoAnalyze;
  document.getElementById('telegramEnabled').checked = config.telegramEnabled;
  document.getElementById('telegramToken').value = config.telegramToken;
  document.getElementById('telegramChatId').value = config.telegramChatId;
  document.getElementById('systemPrompt').value = config.systemPrompt;
}

function saveConfig() {
  const config = {
    apiEndpoint: document.getElementById('apiEndpoint').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value.trim(),
    language: document.getElementById('language').value,
    autoAnalyze: document.getElementById('autoAnalyze').checked,
    telegramEnabled: document.getElementById('telegramEnabled').checked,
    telegramToken: document.getElementById('telegramToken').value.trim(),
    telegramChatId: document.getElementById('telegramChatId').value.trim(),
    systemPrompt: document.getElementById('systemPrompt').value.trim()
  };

  if (!config.apiEndpoint) {
    showStatus('El endpoint es requerido.', '#dc2626');
    return;
  }
  if (!config.apiKey) {
    showStatus('La API key es requerida.', '#dc2626');
    return;
  }

  chrome.storage.sync.set(config, () => {
    showStatus('Configuración guardada correctamente ✅', '#16a34a');
  });
}

function resetConfig() {
  chrome.storage.sync.set(DEFAULT_CONFIG, () => {
    loadConfig();
    showStatus('Valores restablecidos ✅', '#16a34a');
  });
}

function showStatus(msg, color) {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.style.color = color;
  setTimeout(() => { el.textContent = ''; }, 4000);
}

document.getElementById('saveBtn').addEventListener('click', saveConfig);
document.getElementById('resetBtn').addEventListener('click', resetConfig);

loadConfig();
