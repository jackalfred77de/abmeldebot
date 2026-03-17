# AbmeldeBot — Etapa 3: Receção da Abmeldebestätigung + Entrega ao Cliente

## Contexto
O AbmeldeBot (@raferabmeldungbot) é um bot de Telegram que automatiza o processo de Abmeldung em Berlim, operado pela Kanzlei Rechtsanwalt Frederico Reichel.

### Repo e infra
- **Repo:** `jackalfred77de/abmeldebot`
- **Pasta local:** `/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot`
- **Deploy:** GitHub Actions → Azure App Service (auto-deploy via push para `main`)
- **Runtime:** Node.js 20 + Python 3 (pypdf, pymupdf, reportlab)
- **Stack:** Telegraf 4.15, Express 4.22, Axios, dotenv. Email via Microsoft Graph API. Ficheiros no SharePoint via Graph API.

### Ficheiros atuais
| Ficheiro | Linhas | Responsabilidade |
|---|---|---|
| `bot.js` | 766 | Core do bot Telegram: sessões, fluxo de perguntas, handlers de texto/foto/documento/callbacks, geração PDF, envio email, notificação admin, botões approve/reject/hold, comandos /cases e /case |
| `translations.js` | 267 | Traduções DE/PT/EN de todas as mensagens do bot |
| `email.js` | 304 | Envio de email via Microsoft Graph API: `sendAbmeldungEmail()` (email ao cliente) + `sendToBuergeramt()` (email formal ao Bürgeramt com anexos do SharePoint) |
| `server.js` | 207 | Express dashboard: auth, API de casos, preview/send-to-amt, health check |
| `sharepoint.js` | 457 | Integração SharePoint: criação de pastas, upload de ficheiros, lista AbmeldeCases, getCase, updateStatus, addNote, deleteCase |
| `dashboard.html` | 1061 | Dashboard admin: tabela de casos, filtros, painel lateral, modal Bürgeramt preview, botões de ação |
| `bezirk_emails.js` | 39 | Mapa dos 12 Bezirke de Berlim → email do Bürgeramt (verificados) |
| `fill_abmeldung.py` | ~400 | Preenche o PDF oficial de Abmeldung |
| `gen_vollmacht.py` | ~314 | Gera PDF de Vollmacht (procuração) |
| `nationality.js` | ~80 | Mapa de normalização de nacionalidades |
| `plz_map.js` | ~150 | Mapa PLZ → Bezirk de Berlim |

### O que já está feito (Etapas 1 + 2)
1. ✅ **Etapa 1** — Bot completo: multilíngue (DE/PT/EN), recolha de dados, familiares ilimitados, geração PDF, email ao cliente, SharePoint, notificação admin
2. ✅ **Etapa 2A** — Dashboard web: auth, lista de casos, status update, notas, DSGVO delete
3. ✅ **Etapa 2B** — Validação admin Telegram: approve/reject/hold, `/cases`, `/case`, ChatId no SharePoint, notificações ao cliente
4. ✅ **Etapa 2C** — Envio ao Bürgeramt: bezirk_emails, sendToBuergeramt(), preview/send endpoints, modal no dashboard, tracking timeline, notificações cliente

### Status possíveis no SharePoint (fluxo atual)
```
created → email_sent → pending_review → submitted_to_behoerde / sent_to_amt → completed / rejected / on_hold / cancelled
```

### Variáveis de ambiente
```
TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID=661435601
GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER=buero@rafer.de
SP_SITE_ID, SP_DRIVE_ID, SP_LIST_ID, SP_CASES_FOLDER=Abmeldung/Cases
DASHBOARD_PASSWORD
```

### Email do escritório para Abmeldungen
- **Envio ao Bürgeramt:** `abmeldung@rafer.de` (replyTo nos emails ao Bürgeramt)
- **Email geral:** `buero@rafer.de` (GRAPH_SENDER)
- **Fax:** 030 75439509 (pedido na carta ao Bürgeramt como alternativa para envio da confirmação)

---

## O que construir — Etapa 3

### 3A. Absorção Automática da Abmeldebestätigung

**Problema:** Após o envio ao Bürgeramt, a confirmação (Abmeldebestätigung) pode chegar por 3 canais:
1. **Email** — o Bürgeramt responde ao email `abmeldung@rafer.de` (mais comum)
2. **Fax** — chega no número 030 75439509 → o serviço de fax digitaliza e envia como PDF para `abmeldung@rafer.de` (ou outro email configurado)
3. **Correio físico** — carta em papel, precisa ser digitalizada e submetida manualmente

Nos casos 1 e 2, a confirmação acaba por chegar como email com PDF anexo. O caso 3 requer upload manual.

**Requisitos:**

#### 3A.1 — Monitorização de inbox via Microsoft Graph
1. **Polling periódico** — novo módulo `inbox_monitor.js` que verifica a inbox de `abmeldung@rafer.de` a cada 5 minutos
   - Usa Microsoft Graph API: `GET /users/{GRAPH_SENDER}/mailFolders/inbox/messages?$filter=isRead eq false&$orderby=receivedDateTime desc&$top=20&$expand=attachments`
   - **NOTA:** se `GRAPH_SENDER=buero@rafer.de` mas a inbox de Abmeldung é outra, pode ser necessário nova env var `INBOX_MONITOR_EMAIL=abmeldung@rafer.de` ou usar o mesmo sender
   - Filtra emails cujo remetente coincide com um dos domínios dos Bürgerämter (extrair domínios de `bezirk_emails.js`: `ba-mitte.berlin.de`, `ba-fk.berlin.de`, etc.)
   - Também aceitar emails de fax (domínio do serviço de fax a configurar, ex: `@fax.de`, `@sipgate.de`)

2. **Matching automático** — associar email recebido ao caso correto:
   - **Prioridade 1:** Procurar o orderId no assunto ou corpo do email (ex: "ABM-2026-0042")
   - **Prioridade 2:** Procurar nome do cliente no assunto (match com `ClientName` no SharePoint)
   - **Prioridade 3:** Procurar pelo Bezirk do remetente + nome no corpo do email
   - Se não encontrar match → notificar admin com o email para associação manual

3. **Processamento automático** — quando match encontrado:
   - Extrair PDF(s) anexo(s) do email
   - Upload para a pasta SharePoint do caso: `Cases/{orderId}/Abmeldebestaetigung.pdf`
   - Atualizar status do caso → `confirmation_received`
   - Adicionar ao timeline: `"Abmeldebestätigung empfangen am {data} via {email/fax}"`
   - Marcar email como lido no Graph API
   - Notificar admin no Telegram: `"📩 Abmeldebestätigung recebida para {ClientName} ({orderId}) — Bezirk {Bezirk}"`
   - Nova coluna SharePoint: `AbmeldebestaetigungUrl` com o link do ficheiro

4. **Integração no processo** — o polling deve:
   - Iniciar automaticamente quando o servidor Express arranca (dentro de `server.js` ou chamado pelo `bot.js`)
   - Ter intervalo configurável via env var: `INBOX_POLL_INTERVAL=300000` (5 min em ms)
   - Logar cada verificação: `"📬 Inbox check: {n} unread emails, {m} matched"`
   - Ser resiliente a erros (try/catch, continuar mesmo se uma verificação falhar)

#### 3A.2 — Upload manual (para correio físico)
1. **Comando admin no Telegram:** `/upload {orderId}` → espera foto ou documento PDF da Abmeldebestätigung
   - Handler em `bot.js`: verifica que é admin, guarda `session._uploadOrderId`, `session.step = 'admin_upload_bestaetigung'`
   - Quando recebe foto/PDF: upload para SharePoint, atualizar status → `confirmation_received`, notificar admin
2. **Endpoint no Dashboard:** `POST /api/cases/:orderId/upload-bestaetigung` (multipart/form-data)
   - Aceita ficheiro PDF/imagem
   - Upload para SharePoint
   - Atualizar status

#### 3A.3 — Dashboard: secção "Confirmações pendentes"
1. No dashboard, adicionar secção/filtro para casos com status `sent_to_amt` (aguardando resposta do Bürgeramt)
2. Mostrar há quantos dias foi enviado (badge amarelo se >7 dias, vermelho se >14 dias)
3. Botão "Upload manual" para cada caso (abre file picker, chama endpoint)

---

### 3B. Entrega ao Cliente

**Problema:** Após receber a Abmeldebestätigung, o documento precisa ser entregue ao cliente. Duas opções:

#### 3B.1 — Entrega por Email (incluída no preço)
1. **Automática** — quando status muda para `confirmation_received`:
   - Se o cliente escolheu entrega por email (ou não escolheu nada = default):
   - Enviar email ao cliente com a Abmeldebestätigung em anexo
   - Template do email em 3 línguas (DE/PT/EN):
     - DE: "Sehr geehrte(r) Frau/Herr {Name}, anbei erhalten Sie Ihre Abmeldebestätigung. Bei Rückfragen stehen wir Ihnen gerne zur Verfügung."
     - PT: "Prezado(a) Sr(a). {Name}, em anexo encontra a sua confirmação de cancelamento de residência (Abmeldebestätigung)."
     - EN: "Dear Mr./Ms. {Name}, please find attached your confirmation of deregistration (Abmeldebestätigung)."
   - Função: `sendBestaetigung(caseData, pdfPath)` em `email.js`
   - Atualizar status → `completed`
   - Adicionar ao timeline: `"Abmeldebestätigung per Email an {email} gesendet am {data}"`
   - Notificar cliente no Telegram: "📋 A sua Abmeldebestätigung foi enviada por email."
   - Notificar admin: "✅ {ClientName} — Abmeldebestätigung enviada por email. Caso completo."

2. **Manual via Dashboard** — botão "Send Bestätigung to Client" no painel lateral do caso
   - Chama endpoint `POST /api/cases/:orderId/send-bestaetigung`
   - Endpoint: busca PDF do SharePoint, envia email, atualiza status

#### 3B.2 — Entrega por Correio Físico (taxa extra: €15 + portes)
1. **Preço:** Taxa fixa de €15 (serviço) + custo real do correio (variável por destino)
   - Correio normal Alemanha: ~€0,85
   - Europa: ~€1,10
   - Internacional: ~€1,80–3,70
   - Registo (Einschreiben): +€2,65
   - Para simplificar inicialmente: **€15 flat** (inclui portes normais). Se Einschreiben, cobrar extra.

2. **No fluxo do bot** — após a pergunta de email (step `phone` ou após o último campo):
   - Nova pergunta: "Como deseja receber a confirmação (Abmeldebestätigung)?"
   - Botões:
     - `📧 Por email (incluído)` → callback `delivery_email`
     - `📮 Por correio (+€15,00)` → callback `delivery_post`
   - Se `delivery_post`:
     - Perguntar endereço de envio: "Para qual endereço devemos enviar?" (pode ser diferente do novo endereço)
     - Se o novo endereço já foi dado, oferecer botão: `Usar novo endereço ({newFullAddress})` + `Outro endereço`
     - Guardar `session.data.deliveryMethod = 'post'` e `session.data.postalAddress = '...'`
     - Guardar `session.data.postalFee = 15.00`
   - Se `delivery_email`:
     - Guardar `session.data.deliveryMethod = 'email'`
   - Campos novos no SharePoint: `DeliveryMethod` ('email'|'post'), `PostalAddress`, `PostalFee`

3. **No Dashboard** — casos com `delivery_post`:
   - Filtro/badge "📮 Envio postal pendente" para casos com status `confirmation_received` + deliveryMethod=post
   - Mostrar endereço de envio
   - Botão "Marcar como enviado por correio" → muda status para `completed`, adiciona ao timeline
   - Campo para inserir código de rastreamento (opcional)

4. **Resumo e email** — no resumo mostrado ao cliente antes de confirmar:
   - Linha extra: "Entrega: Por correio (€15,00)" ou "Entrega: Por email (incluído)"
   - No email de confirmação ao cliente: mencionar o método escolhido

5. **Traduções novas** (translations.js) — chaves necessárias em DE/PT/EN:
   ```
   ask_delivery_method — "Como deseja receber a sua Abmeldebestätigung?"
   delivery_email_btn — "📧 Por email (incluído)"
   delivery_post_btn — "📮 Por correio (+€15,00)"
   ask_postal_address — "Para qual endereço devemos enviar por correio?"
   use_new_address_btn — "Usar novo endereço"
   other_address_btn — "Outro endereço"
   delivery_email_confirmation — "Sua Abmeldebestätigung será enviada por email após receção."
   delivery_post_confirmation — "Sua Abmeldebestätigung será enviada por correio para {address}. Taxa: €15,00."
   bestaetigung_sent_email — "📋 A sua Abmeldebestätigung foi enviada por email. Verifique a sua caixa de entrada."
   bestaetigung_sent_post — "📮 A sua Abmeldebestätigung foi enviada por correio para {address}."
   bestaetigung_received_notification — "📩 A sua Abmeldebestätigung foi recebida! Enviaremos em breve."
   ```

---

### 3C. Pagamento (Fase Futura — Preparar Estrutura)

**NOTA:** O pagamento real (Stripe, transferência, etc.) NÃO será implementado nesta etapa. Mas a estrutura de dados deve estar preparada.

1. **Campos no SharePoint para pagamento:**
   - `TotalPrice` — preço total (serviço + postal se aplicável)
   - `PaymentStatus` — `pending` | `paid` | `waived`
   - `PaymentMethod` — `stripe` | `transfer` | `cash` | `waived`
   - `PaymentRef` — referência de pagamento

2. **Cálculo do preço no bot:**
   - DIY: €4,99
   - Full Service: €39,99
   - Correio: +€15,00
   - Total mostrado no resumo antes de confirmar

3. **No resumo:**
   - Linha com preço total: "Preço total: €54,99 (Full Service + Envio por correio)"
   - Por enquanto, `summary_correct` confirma sem pagamento (como hoje)

---

## Novo fluxo de status (atualizado)

```
created
  → email_sent
    → pending_review
      → rejected / on_hold / cancelled
      → submitted_to_behoerde (Full Service, admin aprova)
        → sent_to_amt (email enviado ao Bürgeramt)
          → confirmation_received (Abmeldebestätigung recebida)
            → delivery_email_sent (enviado por email ao cliente) → completed
            → delivery_post_pending (aguarda envio por correio) → delivery_post_sent → completed
          → confirmation_overdue (>14 dias sem resposta — flag automática)
```

---

## Restrições técnicas

1. **Mesmo Dockerfile** — manter Node.js 20 + Python 3.
2. **SharePoint como backend** — NÃO adicionar base de dados. Toda a persistência via SharePoint Lists + Files.
3. **Manter compatibilidade** — o bot atual deve continuar a funcionar sem interrupção. Adicionar funcionalidades, não reescrever.
4. **Segurança** — todos os endpoints API verificam auth. Comandos admin verificam ADMIN_CHAT_ID.
5. **Sem pagamento real** — por enquanto, `summary_correct` confirma diretamente. Estrutura de dados preparada para Stripe futuro.
6. **Microsoft Graph permissions** — verificar que o app registration tem permissão `Mail.Read` e `Mail.ReadWrite` para ler inbox e marcar como lido.

## Para editar ficheiros locais
- Para edições pequenas — usa `Filesystem:edit_file` com `oldText`/`newText` (procura e substitui). Funciona sempre, independente do tamanho do ficheiro.
- Para ficheiros novos pequenos (<15KB) — usa `Filesystem:write_file` directamente.
- Para ficheiros novos grandes (>15KB) — NÃO tentes escrever tudo numa única chamada `write_file`. Em vez disso: escreve a primeira parte com `write_file`, faz append das partes seguintes com `edit_file`, substituindo a última linha da parte anterior pela mesma linha + conteúdo novo.
- Para git push — usa `Control your Mac:osascript`:
  ```
  do shell script "cd '/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot' && git add -A && git commit -m 'MENSAGEM' && git push origin main 2>&1"
  ```

## Prioridade de implementação

### Bloco 1 — Pergunta de entrega no bot + campos SharePoint
1. Adicionar tradução das novas chaves em `translations.js`
2. Novo step no `bot.js` após telefone: perguntar método de entrega (email/correio)
3. Se correio: perguntar endereço postal (com opção de reutilizar novo endereço)
4. Novos campos no SharePoint: `DeliveryMethod`, `PostalAddress`, `PostalFee`, `TotalPrice`, `AbmeldebestaetigungUrl`
5. Atualizar resumo para mostrar método de entrega e preço
6. **Deploy + testar**

### Bloco 2 — Monitorização de inbox (absorção automática)
1. Criar `inbox_monitor.js` com polling da inbox via Graph API
2. Lógica de matching (orderId no assunto → nome do cliente → bezirk)
3. Processamento: extrair PDF, upload SharePoint, atualizar status, notificar admin
4. Integrar no startup do servidor (iniciar polling quando Express arranca)
5. **Deploy + testar com email de teste**

### Bloco 3 — Entrega ao cliente
1. `sendBestaetigung()` em `email.js` — email com Abmeldebestätigung anexa
2. Automação: quando status = `confirmation_received` + deliveryMethod = email → enviar
3. Dashboard: botão "Send Bestätigung", secção de confirmações pendentes
4. Notificações ao cliente e admin
5. **Deploy + testar**

### Bloco 4 — Upload manual + correio físico
1. Comando `/upload {orderId}` no Telegram
2. Endpoint upload no dashboard
3. Fluxo de envio por correio no dashboard (marcar como enviado, tracking)
4. Badge de "overdue" para casos >14 dias sem resposta
5. **Deploy + testar**

## Começa pelo Bloco 1 e avança sequencialmente, fazendo deploy após cada bloco funcional.
