# AbmeldeBot — Telegram Admin Validation Buttons + Commands

## Context
AbmeldeBot (@raferabmeldungbot) is a Telegram bot for Abmeldung (deregistration) in Berlin, run by Kanzlei RA Frederico Reichel. The bot collects data, generates PDFs, emails them to clients, and stores everything in SharePoint.

### Repo & infra
- **Repo:** `jackalfred77de/abmeldebot` (GitHub)
- **Local path:** `/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot`
- **Deploy:** Railway (auto-deploy via `git push origin main`)
- **Stack:** Node.js 20, Telegraf 4.15, Express, Microsoft Graph (email + SharePoint), Python 3 (PDF generation)

### What's already done
- ✅ Full bot flow: data collection → PDF generation → email to client → SharePoint archive
- ✅ DSGVO compliance: consent step, privacy link, auto-delete PDFs, local nationality dictionary (no Anthropic API calls), deleteCase in SharePoint, Verarbeitungsverzeichnis
- ✅ Express dashboard server (`server.js`) with API endpoints and admin UI (`dashboard.html`)
- ✅ SharePoint integration: `listCases()`, `getCase()`, `updateCaseStatus()`, `deleteCase()`

### Current files
| File | Lines | Purpose |
|---|---|---|
| `bot.js` | 537 | Telegram bot core: sessions, data flow, PDF gen, email, admin notification, SharePoint upload |
| `server.js` | 148 | Express server with dashboard API endpoints |
| `sharepoint.js` | 454 | Microsoft Graph: folders, file upload, AbmeldeCases list CRUD |
| `translations.js` | 249 | DE/PT/EN translations |
| `email.js` | 119 | Email via Microsoft Graph |
| `nationality.js` | 115 | Local nationality + birthplace normalization dictionaries |
| `dashboard.html` | ~large | Admin dashboard UI |

### Key env vars
```
TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID=661435601
GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER=buero@rafer.de
SP_SITE_ID, SP_DRIVE_ID, SP_LIST_ID, SP_CASES_FOLDER=Abmeldung/Cases
```

---

## CURRENT ADMIN NOTIFICATION (what exists now)

### `notifyAdmin()` in bot.js (line ~100)
```javascript
async function notifyAdmin(session) {
  if (!ADMIN_CHAT_ID) return;
  const { data } = session;
  const message = `🔔 **Neue Abmeldung!**\n\n👤 ${data.firstName} ${data.lastName}\n📧 ${data.email}\n📱 ${data.phone || '–'}\n💼 ${data.service === 'full' ? 'Full Service (€39.99)' : 'DIY (€4.99)'}\n📆 Auszug: ${data.moveOutDate}\n📍 ${data.fullAddress}\n🏛 Bürgeramt: ${data.bezirk}\n\nBestellung: ${data.orderId}`;
  try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' }); }
  catch (error) { console.error('Admin notification error:', error); }
}
```
→ **Just a text message. No buttons. No way to approve/reject from Telegram.**

### `sendPdfToAdmin()` in bot.js (line ~249)
Sends Abmeldung PDF, Vollmacht PDF, Anmeldung, and ID documents as separate `sendDocument` calls to ADMIN_CHAT_ID.

### Post-confirmation flow (line ~290-307)
```
handlePaymentConfirmed() → triggerPowerAutomate() → ... → notifyAdmin() → deleteSession()
```
**Problem:** Session is deleted immediately after notification. There's no way to send messages back to the client later.

### SharePoint columns in `createLedgerEntry()` (line ~140-180)
```
Title (orderId), ClientName, Email, Phone, Service, Bezirk, BerlinAddress,
MoveOutDate, NewAddress, Nationality, Language, Status, CreatedAt, LastUpdated,
AbmeldungUrl, VollmachtUrl, IdFrontUrl, IdBackUrl, AnmeldungUrl, Notes, Timeline
```
**Missing:** `ChatId` — client's Telegram chat ID is NOT stored, so we can't message them later.

### SharePoint functions available
```javascript
SP.updateCaseStatus(orderId, newStatus, note)  // updates Status + Timeline
SP.getCase(orderId)                             // returns single case with all fields
SP.listCases(filter)                            // returns all cases
SP.deleteCase(orderId)                          // deletes list item + folder
```

---

## WHAT TO BUILD

### 1. Store client ChatId in SharePoint

**In sharepoint.js `createLedgerEntry()`** — add `ChatId` field:
```javascript
// Inside the fields object, add:
ChatId: String(session.chatId || ''),
```

**Note:** The column `ChatId` must exist in the SharePoint list. Add it as "Single line of text". For now, just add it to the code — if the column doesn't exist in SP yet, Graph API will simply ignore it (no error).

### 2. Add inline buttons to admin notification

**In bot.js `notifyAdmin()`** — after sending the text message, send a follow-up message with inline action buttons:

```javascript
// After the text message, send action buttons:
await bot.telegram.sendMessage(ADMIN_CHAT_ID, 
  `⚡ Aktion für ${data.orderId}:`, {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ Genehmigen', callback_data: `admin_approve_${data.orderId}` },
        { text: '❌ Ablehnen', callback_data: `admin_reject_${data.orderId}` },
      ],
      [
        { text: '⏸ Zurückstellen', callback_data: `admin_hold_${data.orderId}` },
      ]
    ]
  }
});
```

### 3. Handle admin button callbacks

**New callback handlers in bot.js** — add after the existing button handlers section:

```javascript
// ─── ADMIN ACTIONS ──────────────────────────────────────────────────────
bot.action(/admin_approve_(.+)/, async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return ctx.answerCbQuery('❌ Nicht autorisiert');
  const orderId = ctx.match[1];
  await ctx.answerCbQuery('✅ Genehmigt');
  
  // Get case from SharePoint to check service type
  const caseData = await SP.getCase(orderId);
  if (!caseData) { await ctx.reply(`❌ Fall ${orderId} nicht gefunden`); return; }
  
  const isFullService = caseData.Service === 'full';
  const newStatus = isFullService ? 'submitted_to_behoerde' : 'completed';
  await SP.updateCaseStatus(orderId, newStatus, `Admin genehmigt (${isFullService ? 'Full Service → wird an Bürgeramt gesendet' : 'DIY → abgeschlossen'})`);
  
  await ctx.editMessageText(`✅ *${orderId}* genehmigt → ${newStatus}`, { parse_mode: 'Markdown' });
  
  // Notify client if ChatId is available
  const chatId = caseData.ChatId;
  if (chatId) {
    const lang = caseData.Language || 'de';
    const msgs = {
      de: `✅ Ihre Abmeldung (${orderId}) wurde geprüft und genehmigt.${isFullService ? ' Wir senden das Formular an das Bürgeramt.' : ''}`,
      pt: `✅ Sua Abmeldung (${orderId}) foi verificada e aprovada.${isFullService ? ' Enviaremos o formulário ao Bürgeramt.' : ''}`,
      en: `✅ Your Abmeldung (${orderId}) has been reviewed and approved.${isFullService ? ' We will send the form to the Bürgeramt.' : ''}`,
    };
    try { await bot.telegram.sendMessage(chatId, msgs[lang] || msgs.de); } catch(e) { console.log('Client notification error:', e.message); }
  }
});

bot.action(/admin_reject_(.+)/, async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return ctx.answerCbQuery('❌');
  const orderId = ctx.match[1];
  await ctx.answerCbQuery('Grund eingeben...');
  // Set a temporary state to capture the next text message as rejection reason
  sessions.set('_admin_reject_' + orderId, { orderId, step: 'awaiting_reason' });
  await ctx.editMessageText(`❌ *${orderId}* — Bitte Ablehnungsgrund eingeben:`, { parse_mode: 'Markdown' });
});

bot.action(/admin_hold_(.+)/, async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return ctx.answerCbQuery('❌');
  const orderId = ctx.match[1];
  await ctx.answerCbQuery('⏸ Zurückgestellt');
  await SP.updateCaseStatus(orderId, 'on_hold', 'Admin: zurückgestellt');
  await ctx.editMessageText(`⏸ *${orderId}* zurückgestellt`, { parse_mode: 'Markdown' });
});
```

### 4. Handle rejection reason text

In the **text handler** (`bot.on('text', ...)`), at the VERY TOP before the existing `switch(session.step)`, add a check for admin rejection reason:

```javascript
// Check if this is an admin rejection reason
if (String(ctx.chat.id) === String(ADMIN_CHAT_ID)) {
  // Look for any pending rejection
  for (const [key, val] of sessions.entries()) {
    if (key.startsWith('_admin_reject_') && val.step === 'awaiting_reason') {
      const orderId = val.orderId;
      const reason = text;
      sessions.delete(key);
      await SP.updateCaseStatus(orderId, 'rejected', `Abgelehnt: ${reason}`);
      await ctx.reply(`❌ *${orderId}* abgelehnt.\nGrund: ${reason}`, { parse_mode: 'Markdown' });
      
      // Notify client
      const caseData = await SP.getCase(orderId);
      if (caseData && caseData.ChatId) {
        const lang = caseData.Language || 'de';
        const msgs = {
          de: `❌ Ihre Abmeldung (${orderId}) wurde leider abgelehnt.\n\nGrund: ${reason}\n\nBitte kontaktieren Sie uns: abmeldung@rafer.de`,
          pt: `❌ Sua Abmeldung (${orderId}) foi recusada.\n\nMotivo: ${reason}\n\nPor favor entre em contato: abmeldung@rafer.de`,
          en: `❌ Your Abmeldung (${orderId}) was rejected.\n\nReason: ${reason}\n\nPlease contact us: abmeldung@rafer.de`,
        };
        try { await bot.telegram.sendMessage(caseData.ChatId, msgs[lang] || msgs.de); } catch(e) {}
      }
      return; // Don't process further
    }
  }
}
```

### 5. Admin commands: `/cases` and `/case`

Add new bot commands:

```javascript
// /cases — list pending cases
bot.command('cases', async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return;
  try {
    const cases = await SP.listCases();
    const pending = cases.filter(c => ['pending_review', 'email_sent', 'on_hold'].includes(c.Status));
    if (pending.length === 0) { await ctx.reply('📋 Keine offenen Fälle.'); return; }
    const lines = pending.map(c => 
      `• *${c.Title}* — ${c.ClientName} (${c.Service}) — ${c.Bezirk} — _${c.Status}_`
    ).join('\n');
    await ctx.reply(`📋 *Offene Fälle (${pending.length}):*\n\n${lines}`, { parse_mode: 'Markdown' });
  } catch(e) { await ctx.reply('❌ Fehler: ' + e.message); }
});

// /case AB123 — show details of a specific case
bot.command('case', async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const orderId = (ctx.message.text || '').split(/\s+/)[1];
  if (!orderId) { await ctx.reply('Verwendung: /case ORDERID'); return; }
  try {
    const c = await SP.getCase(orderId);
    if (!c) { await ctx.reply(`❌ Fall ${orderId} nicht gefunden`); return; }
    const detail = `📋 *Fall ${c.Title}*\n\n` +
      `👤 ${c.ClientName}\n📧 ${c.Email}\n📱 ${c.Phone || '–'}\n` +
      `💼 ${c.Service}\n📍 ${c.BerlinAddress}\n🏛 ${c.Bezirk}\n` +
      `📆 Auszug: ${c.MoveOutDate}\n🌍 Neue Adresse: ${c.NewAddress}\n` +
      `🔖 Status: *${c.Status}*\n📅 Erstellt: ${c.CreatedAt}\n` +
      (c.AbmeldungUrl ? `📄 [Abmeldung PDF](${c.AbmeldungUrl})\n` : '') +
      (c.VollmachtUrl ? `📜 [Vollmacht](${c.VollmachtUrl})\n` : '') +
      (c.Notes ? `\n📝 Notizen: ${c.Notes}` : '');
    await ctx.reply(detail, { parse_mode: 'Markdown', disable_web_page_preview: true });
    
    // Show action buttons if case is pending
    if (['pending_review', 'email_sent', 'on_hold'].includes(c.Status)) {
      await ctx.reply(`⚡ Aktion für ${orderId}:`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Genehmigen', callback_data: `admin_approve_${orderId}` },
              { text: '❌ Ablehnen', callback_data: `admin_reject_${orderId}` },
            ],
            [{ text: '⏸ Zurückstellen', callback_data: `admin_hold_${orderId}` }]
          ]
        }
      });
    }
  } catch(e) { await ctx.reply('❌ Fehler: ' + e.message); }
});
```

---

## EXACT CHANGES NEEDED

### File: sharepoint.js
1. **In `createLedgerEntry()`** — add `ChatId: String(session.chatId || ''),` to the fields object, after `Language`

### File: bot.js
1. **`notifyAdmin()`** — after the sendMessage, add a second sendMessage with inline_keyboard buttons (approve/reject/hold)
2. **New callback handlers** — add `admin_approve_`, `admin_reject_`, `admin_hold_` handlers after the existing button handlers block
3. **Text handler** — at the top of `bot.on('text', ...)`, before the session/step logic, add check for admin rejection reason
4. **New commands** — add `/cases` and `/case` commands after the existing `/help` command
5. **Note:** The `bot` object and `SP` module are already available globally in bot.js

### File: translations.js
No changes needed — admin messages are in German only (admin interface).

---

## IMPORTANT NOTES

- `ADMIN_CHAT_ID` is `661435601` — all admin checks compare `ctx.chat.id` against this
- Telegraf callback_data has a 64-byte limit — `admin_approve_AB1234567890XXXXX` fits within this
- The `sessions` Map is used for temporary admin rejection state (`_admin_reject_{orderId}`)
- `SP.getCase(orderId)` returns the SharePoint fields object directly (Title, ClientName, Email, ChatId, etc.)
- `SP.updateCaseStatus(orderId, status, note)` already handles Timeline updates
- Session is deleted after `handlePaymentConfirmed()`, so ChatId MUST be stored in SharePoint before that

## File editing instructions
- Use `Filesystem:edit_file` with `oldText`/`newText` for surgical edits
- Use `Filesystem:write_file` for new files < 15KB
- For git push use `Control your Mac:osascript`:
  ```
  do shell script "cd '/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot' && git add -A && git commit -m 'MESSAGE' && git push origin main 2>&1"
  ```

## Start implementing. Deploy when done.
