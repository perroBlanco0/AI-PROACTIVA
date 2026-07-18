const VISION_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-vision', 'claude-3', 'gemini', 'llama-3.2-vision', 'llava'];

const DEFAULT_CONFIG = {
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: '',
  model: 'deepseek-chat',
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

async function callAI(imageDataUrl, userMessage, history, config, pageUrl, pageTitle) {
  const vision = supportsVision(config.model) && imageDataUrl;
  const isInitial = !userMessage;

  let fullText;
  if (isGemini(config)) {
    fullText = await callGemini(imageDataUrl, userMessage, history, config, vision, isInitial, pageUrl, pageTitle);
  } else {
    fullText = await callOpenAI(imageDataUrl, userMessage, history, config, vision, isInitial, pageUrl, pageTitle);
  }

  const parts = fullText.split('||');
  const mainResponse = parts[0].trim();
  const suggestions = parts.slice(1).filter(s => s.trim().length > 0).map(s => s.trim());

  return { response: mainResponse, suggestions };
}

async function callOpenAI(imageDataUrl, userMessage, history, config, vision, isInitial, pageUrl, pageTitle) {
  const siteContext = pageUrl ? `\n\nContexto: el usuario está en ${pageTitle || 'una página'} (${pageUrl})` : '';
  const messages = [{ role: 'system', content: config.systemPrompt + siteContext }];

  if (history) {
    messages.push({
      role: 'user',
      content: `Historial de la conversación:\n${history}`
    });
  }

  if (isInitial) {
    const prompt = config.language === 'es'
      ? 'Analiza la captura de pantalla. Responde breve y directamente sobre lo que ves. Sugiere 3 preguntas específicas.'
      : 'Look at the screenshot. Respond briefly. Suggest 3 specific questions.';

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

async function callGemini(imageDataUrl, userMessage, history, config, vision, isInitial, pageUrl, pageTitle) {
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
    systemInstruction: { parts: [{ text: config.systemPrompt + (pageUrl ? `\n\nContexto: el usuario está en ${pageTitle || 'una página'} (${pageUrl})` : '') }] },
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

const TELEGRAM_HISTORY_KEY = 'tgHistory';

async function getTelegramHistory() {
  const { [TELEGRAM_HISTORY_KEY]: history = [] } = await chrome.storage.local.get(TELEGRAM_HISTORY_KEY);
  return history;
}

async function addTelegramHistory(userMsg, aiReply) {
  const history = await getTelegramHistory();
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: aiReply });
  if (history.length > 20) history.splice(0, history.length - 20);
  await chrome.storage.local.set({ [TELEGRAM_HISTORY_KEY]: history });
}

async function processTelegramMessage(text, chatId, config) {
  try {
    const wantsScreenshot = /captura|pantalla|screenshot|screen|mira|ve esto/i.test(text);

    if (wantsScreenshot && supportsVision(config.model)) {
      await sendTelegramMessage(chatId, config, '📸 Capturando pantalla...');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No hay pestaña activa');
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
        const visionMessages = [{ role: 'system', content: config.systemPrompt }];
        visionMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: text },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        });
        const resp = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages: visionMessages, temperature: 0.7, max_tokens: 800 })
        });
        if (resp.ok) {
          const data = await resp.json();
          const reply = data.choices[0].message.content.trim();
          const parts = reply.split('||');
          const mainReply = parts[0].trim();
          await addTelegramHistory(text, mainReply);
          await sendTelegramMessage(chatId, config, mainReply);
          return;
        }
      } catch (e) {
        await sendTelegramMessage(chatId, config, `⚠️ No pude capturar la pantalla: ${e.message}`);
        return;
      }
    }

    const history = await getTelegramHistory();
    const messages = [{ role: 'system', content: config.systemPrompt }];
    for (const msg of history) {
      messages.push(msg);
    }
    messages.push({ role: 'user', content: text });

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
      console.error('AI error on Telegram message:', err);
      return;
    }

    const data = await response.json();
    const reply = data.choices[0].message.content.trim();
    const parts = reply.split('||');
    const mainReply = parts[0].trim();

    await addTelegramHistory(text, mainReply);

    await sendTelegramMessage(chatId, config, mainReply);
  } catch (e) {
    console.error('processTelegramMessage error:', e);
  }
}

async function sendTelegramMessage(chatId, config, text) {
  const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
  const cId = isNaN(chatId) ? chatId : Number(chatId);
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: cId,
      text: text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
      parse_mode: 'HTML'
    })
  });
}

async function pollTelegram() {
  try {
    const config = await getConfig();
    if (!config.telegramEnabled || !config.telegramToken || !config.telegramChatId || !config.apiKey) return;

    const { telegramPollOffset = 0 } = await chrome.storage.local.get('telegramPollOffset');
    const chatId = isNaN(config.telegramChatId) ? config.telegramChatId : Number(config.telegramChatId);

    const url = `https://api.telegram.org/bot${config.telegramToken}/getUpdates?offset=${telegramPollOffset}&timeout=30`;
    const resp = await fetch(url);
    if (!resp.ok) return;

    const data = await resp.json();
    if (!data.result || data.result.length === 0) return;

    let maxUpdateId = telegramPollOffset;
    for (const update of data.result) {
      const msg = update.message;
      if (!msg || !msg.text) continue;
      if (msg.chat.id !== chatId) continue;

      maxUpdateId = Math.max(maxUpdateId, update.update_id);
      await processTelegramMessage(msg.text, chatId, config);
    }

    await chrome.storage.local.set({ telegramPollOffset: maxUpdateId + 1 });
  } catch (e) {
    console.error('pollTelegram error:', e);
  }
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'telegram-poll') {
    pollTelegram();
  }
});

async function setupTelegramPoll() {
  const config = await getConfig();
  if (config.telegramEnabled && config.telegramToken && config.telegramChatId && config.apiKey) {
    chrome.alarms?.create('telegram-poll', { periodInMinutes: 1 });
    pollTelegram();
  } else {
    chrome.alarms?.clear('telegram-poll');
  }
}

async function sendToTelegram(text, config) {
  if (!config.telegramEnabled || !config.telegramToken || !config.telegramChatId) return;
  try {
    const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
    const chatId = isNaN(config.telegramChatId) ? config.telegramChatId : Number(config.telegramChatId);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.substring(0, 4000).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
        parse_mode: 'HTML'
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('Telegram API error:', resp.status, err);
    }
  } catch (e) {
    console.error('Telegram fetch error:', e);
  }
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

        const result = await callAI(imageDataUrl, message.query || '', message.history || '', config, message.url, message.title);
        sendResponse(result);
        if (result.response) {
          const urlLine = message.url ? `\n📍 <a href="${message.url.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}">${message.title || message.url}</a>` : '';
          sendToTelegram(`🤖 <b>Respuesta de la IA:</b>\n${result.response}${urlLine}`, config);
        }
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
    chrome.storage.sync.set(message.config, () => {
      sendResponse({ ok: true });
      setupTelegramPoll();
    });
    return true;
  }

  if (message.type === 'TEST_TELEGRAM') {
    getConfig().then(async (config) => {
      if (!config.telegramToken || !config.telegramChatId) {
        sendResponse({ ok: false, error: 'Token o Chat ID no configurados' });
        return;
      }
      try {
        const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
        const chatId = isNaN(config.telegramChatId) ? config.telegramChatId : Number(config.telegramChatId);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '🔔 <b>Prueba desde AI Proactive Agent</b>\nLa conexión con Telegram funciona correctamente.',
            parse_mode: 'HTML'
          })
        });
        if (resp.ok) {
          sendResponse({ ok: true });
        } else {
          const err = await resp.text();
          sendResponse({ ok: false, error: `HTTP ${resp.status}: ${err.substring(0, 200)}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }
});

setupTelegramPoll();
