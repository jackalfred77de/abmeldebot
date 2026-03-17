# AbmeldeBot — Express Server + Dashboard de Casos

## O que é o AbmeldeBot
Bot Telegram (@raferabmeldungbot) que automatiza Abmeldung (cancelamento de residência em Berlim). Operado pela Kanzlei Rechtsanwalt Frederico Reichel. Dois serviços: DIY (€4,99) e Full Service (€39,99).

## Repo e infra
- **Repo:** `jackalfred77de/abmeldebot` (GitHub)
- **Pasta local:** `/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot`
- **Deploy:** Azure App Service (via GitHub Actions / git push origin main)
- **Runtime:** Node.js 20 + Python 3, Dockerfile `node:20-bullseye-slim`
- **Entry point:** `node bot.js` (definido no Dockerfile CMD e package.json `scripts.start`)
- **Dockerfile:** Multi-stage build (Node.js + Python) deployed to Azure App Service

## Ficheiros existentes
| Ficheiro | Linhas | O que faz |
|---|---|---|
| `bot.js` | 535 | Core: Telegraf bot (long polling), sessões in-memory, fluxo de perguntas, geração PDF, envio email, notificação admin, integração SharePoint |
| `sharepoint.js` | 335 | Microsoft Graph API: criar pastas, upload ficheiros, criar/atualizar items na lista `AbmeldeCases` |
| `email.js` | 119 | Envio email via Microsoft Graph (OAuth2, attachments base64) |
| `translations.js` | 237 | Traduções DE/PT/EN |
| `fill_abmeldung.py` | 385 | Preenche PDF oficial de Abmeldung |
| `gen_vollmacht.py` | 314 | Gera PDF de Vollmacht (procuração) |
| `nationality.js` | 54 | Mapa normalização de nacionalidades |
| `plz_map.js` | 57 | Mapa PLZ → Bezirk (12 Bezirke de Berlim) |
| `dashboard.html` | 1 | Placeholder vazio (só um comentário HTML) |

## Estrutura do bot.js (imports relevantes)
```javascript
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const SP = require('./sharepoint');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || '';
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID || '';
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || '';
const GRAPH_SENDER = process.env.GRAPH_SENDER || 'buero@rafer.de';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map(); // in-memory sessions

const { NATIONALITY_MAP, normalizeNationality } = require('./nationality');
const { PLZ_MAP, getBezirk } = require('./plz_map');
const translations = require('./translations');
const { getGraphToken, sendAbmeldungEmail } = require('./email');

// ... handlers, then at bottom:
async function startBot() {
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  await bot.launch({ dropPendingUpdates: true, allowedUpdates: ['message', 'callback_query'] });
}
startBot();
```

## package.json (dependências atuais)
```json
{
  "dependencies": {
    "axios": "^1.6.2",
    "dotenv": "^16.3.1",
    "nodemailer": "^8.0.1",
    "telegraf": "^4.15.0"
  }
}
```

## Variáveis de ambiente
```
TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID
GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER
SP_SITE_ID, SP_DRIVE_ID, SP_LIST_ID, SP_CASES_FOLDER=Abmeldung/Cases
ANTHROPIC_API_KEY
NODE_ENV=production, PYTHON_PATH=python3
```

## SharePoint — o que já existe em sharepoint.js

### Funções exportadas:
```javascript
module.exports = {
  isConfigured,              // → bool: verifica se SP_SITE_ID, SP_DRIVE_ID etc estão configurados
  createCaseFolder,          // (orderId) → cria pasta no SharePoint
  uploadFile,                // (orderId, localPath, filename) → upload ficheiro local
  uploadBase64,              // (orderId, base64Data, filename) → upload imagem base64
  uploadTelegramPhoto,       // (orderId, fileId, filename, telegramBot) → download do Telegram + upload SP
  createLedgerEntry,         // (session, fileUrls) → cria item na lista AbmeldeCases
  updateCaseStatus,          // (orderId, newStatus, note) → atualiza status + timeline de um caso
  processCaseToSharePoint,   // (session, pdfPath, vollmachtPath, bot) → pipeline completo
};
```

### Lista AbmeldeCases — colunas:
`Title` (orderId), `ClientName`, `Email`, `Phone`, `Service` (diy/full), `Bezirk`, `BerlinAddress`, `MoveOutDate`, `NewAddress`, `Nationality`, `Language`, `Status`, `CreatedAt`, `LastUpdated`, `AbmeldungUrl`, `VollmachtUrl`, `IdFrontUrl`, `IdBackUrl`, `AnmeldungUrl`, `Notes`, `Timeline` (JSON string com array de {ts, status, note})

### Status possíveis:
`created`, `pdf_generated`, `email_sent`, `pending_review`, `submitted_to_behoerde`, `completed`, `rejected`, `on_hold`, `cancelled`

### updateCaseStatus() — já existe:
Busca item por orderId (filtro Graph API), faz PATCH nos fields Status, LastUpdated, Timeline, Notes.

### Leitura de casos — NÃO existe:
Não há função para listar todos os casos. Precisa ser criada (GET na lista SharePoint com $expand=fields).

---

## O QUE CONSTRUIR

### 1. Adicionar Express ao mesmo processo

- Adicionar `express` ao package.json
- No `bot.js` (ou num novo `server.js` importado pelo bot.js), criar um Express server que escuta em `process.env.PORT || 3000`
- O bot Telegram continua a correr via long polling no mesmo processo
- Ordem no bot.js: primeiro configura o Express, depois faz `bot.launch()`

### 2. Autenticação simples

- Nova env var: `DASHBOARD_PASSWORD`
- Basic auth ou cookie session simples (sem base de dados — guardar sessão em memória)
- Endpoint `POST /api/login` recebe `{password}` e devolve cookie/token
- Middleware que protege todos os `/api/*` endpoints
- A página `dashboard.html` é servida sem auth (o auth é feito via JS no browser ao chamar a API)

### 3. API endpoints (protegidos por auth)

```
GET  /api/cases              → lista todos os casos do SharePoint (AbmeldeCases)
GET  /api/cases/:orderId     → detalhes de um caso específico
PATCH /api/cases/:id/status  → body: { status: "...", note: "..." } → chama SP.updateCaseStatus()
POST /api/cases/:id/notes    → body: { note: "..." } → adiciona nota ao timeline
```

### 4. Função `listCases()` no sharepoint.js

Adicionar ao sharepoint.js:
```javascript
async function listCases(filter = '') {
  // GET /sites/{siteId}/lists/{listId}/items?$expand=fields&$top=200
  // Retorna array de items com todos os fields
}
```

### 5. Dashboard HTML (ficheiro `dashboard.html`)

Servido em `GET /` (ou `GET /dashboard`). HTML/CSS/JS tudo inline (single file, sem build).

**Layout:**
- Topo: contadores (Total | Pendentes | Enviados | Completos)
- Filtros: dropdown Status, dropdown Bezirk, dropdown Service (diy/full), campo busca texto
- Tabela principal: orderId, ClientName, Service, Bezirk, Status, CreatedAt, Email
- Clicar numa linha abre painel lateral direito com:
  - Todos os dados do caso
  - Links para ficheiros no SharePoint (abrem em nova aba)
  - Timeline (lista de eventos com data + nota)
  - Botões: Aprovar, Rejeitar, Em Espera, campo de nota + Adicionar Nota
- Cores: verde = completed, azul = submitted_to_behoerde, amarelo = pending_review, vermelho = rejected, cinza = cancelled
- Auto-refresh a cada 30 segundos (fetch silencioso, sem recarregar página)
- Mobile-friendly (tabela scrollável, painel lateral vira overlay em telas pequenas)
- Login: ao abrir, se não está autenticado, mostra campo de password + botão Login

**Design:**
- Limpo, profissional, cores neutras com acentos de cor nos status badges
- Fonte: system-ui
- Sem frameworks CSS — CSS puro ou Tailwind via CDN

---

## Restrições

1. **Não reescrever bot.js** — adicionar o Express server e os endpoints, manter tudo o que existe
2. **Sem base de dados** — toda a persistência é SharePoint
3. **Manter Dockerfile** — só adicionar `express` ao package.json
4. **Azure** — o Express usa `process.env.PORT`, o bot Telegram usa long polling. Ambos no mesmo processo.
5. **Deploy** — git push para main → GitHub Actions → auto-deploy no Azure App Service

## Para editar ficheiros locais
- Para edições pequenas — usa `Filesystem:edit_file` com `oldText`/`newText` (procura e substitui)
- Para ficheiros novos pequenos (<15KB) — usa `Filesystem:write_file` directamente
- Para ficheiros novos grandes (>15KB) — escreve a primeira parte com `write_file`, faz append das partes seguintes com `edit_file` (substituindo a última linha da parte anterior pela mesma linha + conteúdo novo)
- Para git push — usa `Control your Mac:osascript`:
  ```
  do shell script "cd '/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot' && git add -A && git commit -m 'MENSAGEM' && git push origin main 2>&1"
  ```
- Para verificar estado — usa `osascript` com `git status`, `git log`, `grep -n TEXTO ficheiro`, etc.

## Ordem de implementação
1. `npm install express` (editar package.json)
2. Criar `listCases()` e `getCase()` no sharepoint.js
3. Criar Express server + auth + API endpoints (pode ser num novo `server.js` ou direto no bot.js)
4. Criar `dashboard.html` completo
5. Testar localmente se possível, depois git push para deploy

## Começa.
