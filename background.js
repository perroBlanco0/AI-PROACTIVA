const VISION_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-vision', 'claude-3', 'gemini', 'llama-3.2-vision', 'llava'];

const DEFAULT_CONFIG = {
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: '',
  model: 'deepseek-chat',
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

function supportsVision(model) {
  return VISION_MODELS.some(v => model.toLowerCase().includes(v.toLowerCase()));
}

function isGemini(config) {
  return config.model.toLowerCase().includes('gemini') || config.apiEndpoint.includes('googleapis.com');
}

async function getConfig() {
  const result = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  return { ...DEFAULT_CONFIG, ...result };
}

async function captureTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'jpeg',
    quality: 70
  });
  return dataUrl;
}

async function callAI(imageDataUrl, userMessage, history, config) {
  const vision = supportsVision(config.model) && imageDataUrl;
  const isInitial = !userMessage;

  let fullText;
  if (isGemini(config)) {
    fullText = await callGemini(imageDataUrl, userMessage, history, config, vision, isInitial);
  } else {
    fullText = await callOpenAI(imageDataUrl, userMessage, history, config, vision, isInitial);
  }

  const parts = fullText.split('||');
  const mainResponse = parts[0].trim();
  const suggestions = parts.slice(1).filter(s => s.trim().length > 0).map(s => s.trim());

  return { response: mainResponse, suggestions };
}

async function callOpenAI(imageDataUrl, userMessage, history, config, vision, isInitial) {
  const messages = [{ role: 'system', content: config.systemPrompt }];

  if (history) {
    messages.push({
      role: 'user',
      content: `Historial de la conversación:\n${history}`
    });
  }

  if (isInitial) {
    const prompt = config.language === 'es'
      ? 'Acabo de llegar a esta página. Observa la captura de pantalla y preséntate. Luego sugiere 2-3 preguntas relevantes sobre lo que ves. Responde en español.'
      : 'I just arrived at this page. Look at the screenshot and introduce yourself. Then suggest 2-3 relevant questions.';

    if (vision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }
  } else {
    if (vision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userMessage },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }
  }

  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 800
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err.substring(0, 500)}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function callGemini(imageDataUrl, userMessage, history, config, vision, isInitial) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  let promptText;
  if (isInitial) {
    promptText = config.language === 'es'
      ? 'Acabo de llegar a esta página. Observa la captura de pantalla y preséntate. Luego sugiere 2-3 preguntas relevantes. Responde en español.'
      : 'I just arrived at this page. Look at the screenshot and introduce yourself. Then suggest 2-3 relevant questions.';
  } else {
    promptText = history
      ? `Historial de la conversación:\n${history}\n\nNuevo mensaje del usuario:\n${userMessage}`
      : userMessage;
  }

  let userParts;
  if (vision && isInitial) {
    const b64 = imageDataUrl.split(',')[1];
    userParts = [
      { text: promptText },
      { inlineData: { mimeType: 'image/jpeg', data: b64 } }
    ];
  } else {
    userParts = [{ text: promptText }];
  }

  const body = {
    contents: [{ role: 'user', parts: userParts }],
    systemInstruction: { parts: [{ text: config.systemPrompt }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err.substring(0, 500)}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text.trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_SCREENSHOT') {
    getConfig().then(async (config) => {
      if (!config.apiKey) {
        sendResponse({ error: 'API key no configurada. Abre las opciones de la extensión.' });
        return;
      }
      try {
        const tabId = sender.tab?.id || message.tabId;
        if (!tabId) {
          sendResponse({ error: 'No se pudo identificar la pestaña.' });
          return;
        }

        const vision = supportsVision(config.model);
        if (!vision) {
          sendResponse({ error: `El modelo "${config.model}" no soporta análisis de imágenes. Usa uno con visión: gpt-4o-mini, gemini-2.0-flash, etc.` });
          return;
        }

        let imageDataUrl;
        try {
          imageDataUrl = await captureTab(tabId);
        } catch (e) {
          sendResponse({ error: `No se pudo capturar la pantalla: ${e.message}` });
          return;
        }

        const result = await callAI(imageDataUrl, message.query || '', message.history || '', config);
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }

  if (message.type === 'GET_CONFIG') {
    getConfig().then(config => {
      const { apiKey, ...safeConfig } = config;
      sendResponse(safeConfig);
    });
    return true;
  }

  if (message.type === 'SAVE_CONFIG') {
    chrome.storage.sync.set(message.config, () => sendResponse({ ok: true }));
    return true;
  }
});
