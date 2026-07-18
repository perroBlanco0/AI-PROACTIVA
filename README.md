# 🤖 AI Proactive Agent

Extensión de Chrome con visión artificial y chat vía Telegram. Analiza lo que ves en pantalla, responde preguntas y sugiere acciones.

## Funcionalidades

- **Visión artificial** — captura la pantalla y la analiza con IA (OpenAI, Gemini, GitHub Models)
- **Chat flotante** — widget integrado en cualquier página web
- **Bot de Telegram** — chatea con la IA desde Telegram, pídele capturas de pantalla
- **Historial de conversación** — la IA recuerda el contexto
- **Prompt personalizable** — define el comportamiento de la IA
- **Multilenguaje** — español e inglés

## Requisitos

- Chrome (Manifest V3)
- Una API key de un proveedor de IA con visión: [GitHub Models](https://github.com/marketplace/models) (gratis), [Gemini](https://aistudio.google.com/apikey) (gratis) o [OpenAI](https://platform.openai.com/api-keys)

## Instalación

1. Clona o descarga este repositorio
2. Abre `chrome://extensions`
3. Activa **Modo desarrollador**
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta del proyecto

## Configuración

1. Haz clic en el ícono de la extensión → ⚙️ Configuración
2. Ingresa tu **API Key**, **Endpoint** y **Modelo** (con visión)
3. Guarda y comienza a usar el chat

### Telegram (opcional)

1. Crea un bot con [@BotFather](https://t.me/BotFather)
2. Obtén tu Chat ID con [@userinfobot](https://t.me/userinfobot)
3. Configura token y chat ID en las opciones de la extensión
4. Activa el checkbox y envía `/start` a tu bot

## Uso

- **📸 Analizar esta página** — captura pantalla y la analiza
- **💬 Abrir chat** — abre el widget flotante en la página
- **📨 Probar Telegram** — verifica la conexión con tu bot

### Comandos de Telegram

- Envía cualquier mensaje para conversar
- `captura`, `pantalla`, `mira esto` — el bot captura tu pantalla y la analiza

## Licencia

MIT
