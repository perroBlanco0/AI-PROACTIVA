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

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

async function extractPdfText(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let text = '';
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === 0x28) {
      i++;
      let chunk = '';
      while (i < bytes.length && bytes[i] !== 0x29) {
        if (bytes[i] === 0x5c && i + 1 < bytes.length) {
          i++;
          const next = bytes[i];
          if (next === 0x6e) chunk += '\n';
          else if (next === 0x72) chunk += '\r';
          else if (next === 0x74) chunk += '\t';
          else if (next === 0x28) chunk += '(';
          else if (next === 0x29) chunk += ')';
          else chunk += String.fromCharCode(next);
        } else if (bytes[i] >= 0x20 && bytes[i] <= 0x7e) {
          chunk += String.fromCharCode(bytes[i]);
        } else if (bytes[i] > 0x7e && bytes[i] < 0xff) {
          const c = String.fromCharCode(bytes[i], bytes[i + 1] || 0);
          chunk += c;
        }
        i++;
      }
      if (chunk.trim().length > 2) text += chunk + ' ';
    } else if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
      i += 2;
      let hex = '';
      while (i < bytes.length && bytes[i] !== 0x3e) {
        hex += String.fromCharCode(bytes[i]);
        i++;
      }
      const code = parseInt(hex.trim(), 16);
      if (!isNaN(code) && code >= 32 && code <= 126) text += String.fromCharCode(code);
    }
    i++;
  }
  return text.replace(/\s+/g, ' ').trim().substring(0, 15000) || null;
}

async function fetchUrlContent(url) {
  if (/\.pdf($|\?)/i.test(url)) {
    try {
      const pdfText = await extractPdfText(url);
      if (pdfText) return pdfText;
    } catch (e) {}
  }
  try {
    const rawUrl = url.includes('github.com') && !url.includes('raw.')
      ? url.replace('github.com', 'raw.githubusercontent.com').replace(/\/blob\//, '/') + '/main/README.md'
      : url;
    const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    return text.substring(0, 12000);
  } catch (e) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const html = await resp.text();
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return text.substring(0, 12000);
    } catch (e2) {
      return null;
    }
  }
}

async function replyWithAI(chatId, config, text, msgs) {
  const reply = await callAIWithHistory(msgs, config);
  const parts = reply.split('||');
  const mainReply = parts[0].trim();
  const suggestions = parts.slice(1).filter(s => s.trim().length > 0).map(s => s.trim());
  let fullText = mainReply;
  if (suggestions.length > 0) {
    const list = suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
    fullText += `\n\n${list}`;
  }
  await addTelegramHistory(text, mainReply);
  await sendTelegramMessage(chatId, config, fullText, suggestions);
}

const NOTES_KEY = 'savedNotes';
let taskMode = false;

async function getSavedNotes() {
  const { [NOTES_KEY]: notes = [] } = await chrome.storage.local.get(NOTES_KEY);
  return notes;
}

async function saveNote(title, content) {
  const notes = await getSavedNotes();
  notes.push({ title, content, date: new Date().toISOString() });
  if (notes.length > 50) notes.splice(0, notes.length - 50);
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
}

async function processTelegramMessage(text, chatId, config) {
  try {
    sendTelegramTyping(chatId, config);

    if (/^\/notas/i.test(text)) {
      const notes = await getSavedNotes();
      if (notes.length === 0) {
        await sendTelegramMessage(chatId, config, '📝 No tienes notas guardadas todavía.');
      } else {
        const list = notes.slice(-10).reverse().map((n, i) => `${i + 1}. ${n.title}`).join('\n');
        await sendTelegramMessage(chatId, config, `📝 *Últimas notas:*\n\n${list}\n\nUsá "nota 1", "nota 2"... para ver el detalle.`);
      }
      return;
    }

    if (/^nota \d+/i.test(text)) {
      const idx = parseInt(text.match(/\d+/)[0], 10);
      const notes = await getSavedNotes();
      const note = notes[notes.length - idx];
      if (note) {
        const date = new Date(note.date).toLocaleString();
        await sendTelegramMessage(chatId, config, `📌 <b>${note.title}</b> (${date})\n\n${note.content.substring(0, 2000)}`);
      } else {
        await sendTelegramMessage(chatId, config, '⚠️ Nota no encontrada.');
      }
      return;
    }

    if (/^(guarda|nota|report|guarda eso)/i.test(text)) {
      const history = await getTelegramHistory();
      const lastResponse = history.filter(m => m.role === 'assistant').pop();
      if (lastResponse) {
        const title = text.replace(/^(guarda|nota|report|guarda eso)\s*/i, '').substring(0, 80) || 'Nota sin título';
        await saveNote(title, lastResponse.content);
        await sendTelegramMessage(chatId, config, `✅ Nota guardada: "${title}"`);
      } else {
        await sendTelegramMessage(chatId, config, '⚠️ No hay respuesta anterior para guardar.');
      }
      return;
    }

    if (/^\/tarea/i.test(text)) {
      taskMode = true;
      await sendTelegramMessage(chatId, config, '📚 <b>Modo tarea activado</b>\nTe guiaré paso a paso sin darte la respuesta directa. Enviá /fin para salir.');
      return;
    }

    if (/^\/fin/i.test(text)) {
      taskMode = false;
      await sendTelegramMessage(chatId, config, '✅ Modo tarea desactivado.');
      return;
    }

    const wantsRead = /lee|read/i.test(text);
      let url = extractUrl(text);
      if (!url) {
        const history = await getTelegramHistory();
        for (let i = history.length - 1; i >= 0; i--) {
          const found = extractUrl(history[i].content);
          if (found) { url = found; break; }
        }
      }
      if (url) {
        await sendTelegramMessage(chatId, config, `🌐 Leyendo ${url}...`);
        sendTelegramTyping(chatId, config);
        const content = await fetchUrlContent(url);
        if (content) {
          const msgs = [{ role: 'system', content: config.systemPrompt }];
          msgs.push({ role: 'user', content: `He visitado ${url} y este es su contenido:\n\n${content}\n\n${text}` });
          try { await replyWithAI(chatId, config, text, msgs); return; }
          catch (e) { await sendTelegramMessage(chatId, config, `⚠️ Error: ${e.message}`); return; }
        } else {
          await sendTelegramMessage(chatId, config, '⚠️ No pude leer el contenido de esa URL.');
          return;
        }
      }
    }

    if (wantsScreenshot && supportsVision(config.model)) {
      await sendTelegramMessage(chatId, config, '📸 Capturando pantalla...');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No hay pestaña activa');
        try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
        const msgs = [{ role: 'system', content: config.systemPrompt }];
        msgs.push({
          role: 'user',
          content: [
            { type: 'text', text: text },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        });
        sendTelegramTyping(chatId, config);
        try { await replyWithAI(chatId, config, text, msgs); return; }
        catch (e) { await sendTelegramMessage(chatId, config, `⚠️ Error: ${e.message}`); return; }
      } catch (e) {
        await sendTelegramMessage(chatId, config, `⚠️ No pude capturar la pantalla: ${e.message}`);
        return;
      }
    }

    const history = await getTelegramHistory();
    const taskPrompt = taskMode
      ? `\n\nModo TUTOR activo: Eres un tutor que guía al estudiante paso a paso. No des la respuesta directa. Haz preguntas que lo lleven a descubrir la solución por sí mismo. Sé paciente y educativo.`
      : '';
    const messages = [{ role: 'system', content: config.systemPrompt + taskPrompt }];
    for (const msg of history) {
      messages.push(msg);
    }
    messages.push({ role: 'user', content: text });

    try {
      sendTelegramTyping(chatId, config);
      await replyWithAI(chatId, config, text, messages);
    } catch (e) {
      await sendTelegramMessage(chatId, config, `⚠️ Error: ${e.message}`);
    }
  } catch (e) {
    console.error('processTelegramMessage error:', e);
  }
}

async function sendTelegramMessage(chatId, config, text, suggestions) {
  const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
  const cId = isNaN(chatId) ? chatId : Number(chatId);
  const body = {
    chat_id: cId,
    text: text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    parse_mode: 'HTML'
  };
  if (suggestions && suggestions.length > 0) {
    body.reply_markup = {
      inline_keyboard: suggestions.filter(s => s).map(s => [{ text: s.substring(0, 50), callback_data: s.substring(0, 64) }])
    };
  }
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function sendTelegramTyping(chatId, config) {
  const url = `https://api.telegram.org/bot${config.telegramToken}/sendChatAction`;
  const cId = isNaN(chatId) ? chatId : Number(chatId);
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cId, action: 'typing' })
  });
}

async function callAIWithHistory(messages, config) {
  if (isGemini(config)) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const otherMsgs = messages.filter(m => m.role !== 'system');
    const body = {
      contents: otherMsgs.map(m => {
        if (Array.isArray(m.content)) {
          return { role: 'user', parts: m.content.map(c => {
            if (c.type === 'image_url') return { inlineData: { mimeType: 'image/jpeg', data: c.image_url.url.split(',')[1] } };
            return { text: c.text };
          })};
        }
        return { role: 'user', parts: [{ text: m.content }] };
      }),
      systemInstruction: { parts: [{ text: systemMsg }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text.trim();
  } else {
    const resp = await fetch(config.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.7, max_tokens: 800 })
    });
    if (!resp.ok) throw new Error(`API error ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    const data = await resp.json();
    return data.choices[0].message.content.trim();
  }
}

let telegramPolling = false;

async function pollTelegram() {
  if (telegramPolling) return;
  telegramPolling = true;
  try {
    const config = await getConfig();
    if (!config.telegramEnabled || !config.telegramToken || !config.telegramChatId || !config.apiKey) return;

    const { telegramPollOffset = 0 } = await chrome.storage.local.get('telegramPollOffset');
    const chatId = isNaN(config.telegramChatId) ? config.telegramChatId : Number(config.telegramChatId);

    const url = `https://api.telegram.org/bot${config.telegramToken}/getUpdates?offset=${telegramPollOffset}`;
    const resp = await fetch(url);
    if (!resp.ok) return;

    const data = await resp.json();
    if (!data.result || data.result.length === 0) return;

    let maxUpdateId = telegramPollOffset;
    for (const update of data.result) {
      maxUpdateId = Math.max(maxUpdateId, update.update_id);

      if (update.callback_query) {
        const cq = update.callback_query;
        if (cq.message?.chat?.id !== chatId) continue;
        await fetch(`https://api.telegram.org/bot${config.telegramToken}/answerCallbackQuery?callback_query_id=${cq.id}`);
        await processTelegramMessage(cq.data, chatId, config);
        continue;
      }

      const msg = update.message;
      if (!msg || !msg.text) continue;
      if (msg.chat.id !== chatId) continue;

      await processTelegramMessage(msg.text, chatId, config);
    }

    await chrome.storage.local.set({ telegramPollOffset: maxUpdateId + 1 });
  } catch (e) {
    console.error('pollTelegram error:', e);
  }
  telegramPolling = false;
  chrome.alarms?.clear('telegram-poll-next');
  chrome.alarms?.create('telegram-poll-next', { delayInMinutes: 1 });
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'telegram-poll' || alarm.name === 'telegram-poll-next') {
    pollTelegram();
  }
});

async function setupTelegramPoll() {
  const config = await getConfig();
  if (config.telegramEnabled && config.telegramToken && config.telegramChatId && config.apiKey) {
    chrome.alarms?.clear('telegram-poll');
    chrome.alarms?.clear('telegram-poll-next');
    chrome.alarms?.create('telegram-poll', { periodInMinutes: 2 });
    chrome.alarms?.create('telegram-poll-next', { delayInMinutes: 1 });
    pollTelegram();
  } else {
    chrome.alarms?.clear('telegram-poll');
    chrome.alarms?.clear('telegram-poll-next');
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

chrome.tabs?.onActivated.addListener(() => pollTelegram());
chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => { if (changeInfo.status === 'complete') pollTelegram(); });
chrome.runtime?.onStartup.addListener(() => setupTelegramPoll());

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

  if (message.type === 'SAVE_NOTE') {
    getConfig().then(async (config) => {
      await saveNote(message.title || 'Nota', message.content);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'GET_NOTES') {
    getSavedNotes().then(n => sendResponse(n));
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
