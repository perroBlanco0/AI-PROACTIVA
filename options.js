const DEFAULT_CONFIG = {
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: '',
  model: 'gemini-2.0-flash',
  language: 'es',
  autoAnalyze: true,
  systemPrompt: `Eres un asistente de IA proactivo y conversacional integrado en el navegador del usuario. Tienes visión artificial y ves la pantalla del usuario en cada mensaje.

Personalidad: directo, útil, práctico. Sin rodeos.

Reglas:
1. Responde SIEMPRE con una conclusión breve y clara (máximo 3-4 líneas).
2. Al final, sugiere el siguiente paso lógico en forma de pregunta.
3. Tus respuestas deben sonar a "resumen ejecutivo" + "¿qué sigue?".
4. Mantén contexto de toda la conversación.

Siempre respondes en el mismo idioma que el usuario.
Al final de tu respuesta, incluye 2-3 sugerencias de preguntas de seguimiento separadas por "||".

Formato de respuesta:
[Conclusión breve]

||¿Siguiente paso 1?||¿Siguiente paso 2?||¿Siguiente paso 3?`
};

async function loadConfig() {
  const result = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  const config = { ...DEFAULT_CONFIG, ...result };

  document.getElementById('apiEndpoint').value = config.apiEndpoint;
  document.getElementById('apiKey').value = config.apiKey;
  document.getElementById('model').value = config.model;
  document.getElementById('language').value = config.language;
  document.getElementById('autoAnalyze').checked = config.autoAnalyze;
  document.getElementById('systemPrompt').value = config.systemPrompt;
}

function saveConfig() {
  const config = {
    apiEndpoint: document.getElementById('apiEndpoint').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value.trim(),
    language: document.getElementById('language').value,
    autoAnalyze: document.getElementById('autoAnalyze').checked,
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
