#!/usr/bin/env node
/**
 * patch_bot.js — aplica dois fixes ao bot.js do AbmeldeBot
 *
 * Fix 1: Substitui assinatura de email antiga pela nova (com fonte Akagi + logo Reichel)
 * Fix 2: Handler corr_newaddress inicia fluxo de 3 passos (rua → PLZ+cidade → país)
 *
 * Uso:
 *   node patch_bot.js [caminho/para/bot.js] [caminho/para/email_signature.html]
 *
 * Defaults:
 *   bot.js          → ~/Library/CloudStorage/OneDrive-FredericoReichel/
 *                      BüroEasy - Documents/Abmeldung/abmeldebot/bot.js
 *   signature.html  → mesmo directório do script  OU  /tmp/email_signature.html
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ── Resolve caminhos ─────────────────────────────────────────────────────────
const BOT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      process.env.HOME,
      'Library/CloudStorage/OneDrive-FredericoReichel',
      'BüroEasy - Documents/Abmeldung/abmeldebot/bot.js'
    );

if (!fs.existsSync(BOT_PATH)) {
  console.error(`❌  bot.js não encontrado: ${BOT_PATH}`);
  console.error('    Passa o caminho como 1.º argumento.');
  process.exit(1);
}

const SIG_CANDIDATES = [
  process.argv[3],
  path.join(path.dirname(BOT_PATH),  'email_signature.html'),
  path.join(path.dirname(__filename),'email_signature.html'),
  '/tmp/email_signature.html',
];
const SIG_PATH = SIG_CANDIDATES.find(p => p && fs.existsSync(p));
if (!SIG_PATH) {
  console.error('❌  email_signature.html não encontrado.');
  console.error('    Coloca-o em /tmp/email_signature.html  ou no mesmo directório do script.');
  process.exit(1);
}

console.log(`📂  bot.js         : ${BOT_PATH}`);
console.log(`📄  signature.html : ${SIG_PATH}`);

// ── Lê ficheiros ─────────────────────────────────────────────────────────────
let src = fs.readFileSync(BOT_PATH, 'utf8');
const sigHtml = fs.readFileSync(SIG_PATH, 'utf8');

// ── Extrai <style> e <body> da assinatura ────────────────────────────────────
function extract(html, tag) {
  const open = `<${tag}>`, close = `</${tag}>`;
  const s = html.indexOf(open), e = html.indexOf(close);
  if (s < 0 || e < 0) throw new Error(`Tag <${tag}> não encontrada em email_signature.html`);
  return html.slice(s + open.length, e).trim();
}
const sigStyle = extract(sigHtml, 'style');
const sigBody  = extract(sigHtml, 'body');

// Escapa para uso numa template literal JS (backtick, ${ e \)
function escTpl(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
const sigStyleEsc = escTpl(sigStyle);
const sigBodyEsc  = escTpl(sigBody);

let changed = 0;

// ── FIX 1A — apaga const SIG_B64 ────────────────────────────────────────────
{
  const re = /^[ \t]*const SIG_B64 = '\/9j\/4AA[^']*';\n/m;
  if (!re.test(src)) {
    console.warn('⚠️   const SIG_B64 não encontrada (já removida ou padrão mudou).');
  } else {
    src = src.replace(re, '');
    console.log('✅  Fix 1A: const SIG_B64 removida.');
    changed++;
  }
}

// ── FIX 1B — substitui bloco de assinatura antigo ───────────────────────────
{
  const SIG_ANCHOR_START = "'<p>Mit freundlichen Gr";
  const SIG_ANCHOR_END   = "'WhatsApp +49 155 60245902</p>';";

  const si = src.indexOf(SIG_ANCHOR_START);
  const ei = src.indexOf(SIG_ANCHOR_END);

  if (si < 0 || ei < 0) {
    console.warn('⚠️   Bloco de assinatura antigo não encontrado (já substituído ou padrão mudou).');
  } else {
    const oldBlock = src.slice(si, ei + SIG_ANCHOR_END.length);
    const newBlock =
      '`<style>${sigStyle}</style>` +\n' +
      '    sigBody';

    const HTML_BODY_DECL = '  const htmlBody =';
    if (!src.includes(HTML_BODY_DECL)) {
      console.error('❌  "const htmlBody =" não encontrado — não é possível injectar as constantes.');
      process.exit(1);
    }
    const SIG_CONSTS =
      `  const sigStyle = \`${sigStyleEsc}\`;\n` +
      `  const sigBody  = \`${sigBodyEsc}\`;\n\n`;

    src = src.replace(HTML_BODY_DECL, SIG_CONSTS + HTML_BODY_DECL);
    src = src.replace(oldBlock, newBlock);

    console.log('✅  Fix 1B: Bloco de assinatura HTML substituído.');
    changed++;
  }
}

// ── FIX 2 — handler corr_newaddress inicia fluxo de 3 passos ────────────────
{
  const OLD_CORR =
`bot.action(/corr_(.+)/, async (ctx) => {
  const session = getSession(ctx.chat.id);
  const field = ctx.match[1];
  if (!CORR_FIELD_MAP[field]) return ctx.answerCbQuery();
  session.step = \`corr_\${field}\`;
  await ctx.answerCbQuery();
  await ctx.reply(t(session, 'correct_enter_new'));
});`;

  const NEW_CORR =
`bot.action(/corr_(.+)/, async (ctx) => {
  const session = getSession(ctx.chat.id);
  const field = ctx.match[1];
  if (!CORR_FIELD_MAP[field]) return ctx.answerCbQuery();
  await ctx.answerCbQuery();

  if (field === 'newaddress') {
    session.step = 'corr_newaddress_street';
    await ctx.reply(t(session, 'ask_newaddress_street'));
  } else {
    session.step = \`corr_\${field}\`;
    await ctx.reply(t(session, 'correct_enter_new'));
  }
});`;

  if (!src.includes(OLD_CORR)) {
    console.warn('⚠️   Handler corr_ antigo não encontrado (já alterado ou padrão mudou).');
  } else {
    src = src.replace(OLD_CORR, NEW_CORR);
    console.log('✅  Fix 2: Handler corr_newaddress actualizado.');
    changed++;
  }
}

// ── FIX 2B — garante passos 2 e 3 no text handler ───────────────────────────
{
  const HAS_STEP2 = src.includes("session.step === 'corr_newaddress_plzcity'");
  if (HAS_STEP2) {
    console.log('✅  Fix 2B: Fluxo de 3 passos no text handler já presente.');
  } else {
    const INJECT_BEFORE = `  // Correção pontual de campo\n  if (session.step && session.step.startsWith('corr_')) {`;
    const NEW_3STEP =
`  // Correcção da nova morada — passos 2 e 3
  if (session.step === 'corr_newaddress_plzcity') {
    session.data.newPlzCity = text;
    session.step = 'corr_newaddress_country';
    await ctx.reply(t(session, 'ask_newaddress_country'));
    return;
  }
  if (session.step === 'corr_newaddress_country') {
    session.data.newCountry = text;
    session.data.newFullAddress = \`\${session.data.newStreet}, \${session.data.newPlzCity}, \${session.data.newCountry}\`;
    session.step = null;
    await ctx.reply('✅');
    await showSummary(ctx, session);
    return;
  }

  `;
    if (!src.includes(INJECT_BEFORE)) {
      console.warn('⚠️   Ponto de injecção dos passos 2/3 não encontrado no text handler.');
    } else {
      src = src.replace(INJECT_BEFORE, NEW_3STEP + INJECT_BEFORE);
      console.log('✅  Fix 2B: Passos 2 e 3 injectados no text handler.');
      changed++;
    }
  }
}

// ── FIX 2C — ramo newaddress no bloco corr_ do text handler ─────────────────
{
  const HAS_NEWADDR = src.includes("field === 'newaddress'");
  if (HAS_NEWADDR) {
    console.log('✅  Fix 2C: Ramo newaddress no text handler já presente.');
  } else {
    const ADDR_END =
`        session.data.bezirk = getBezirk(plz);
      } else {`;
    const NEW_ADDR_END =
`        session.data.bezirk = getBezirk(plz);
      } else if (field === 'newaddress') {
        // Inicia fluxo de 3 perguntas para nova morada
        session.data.newStreet = text;
        session.step = 'corr_newaddress_plzcity';
        await ctx.reply(t(session, 'ask_newaddress_plzcity'));
        return;
      } else {`;

    if (!src.includes(ADDR_END)) {
      console.warn('⚠️   Ponto de injecção do ramo newaddress não encontrado.');
    } else {
      src = src.replace(ADDR_END, NEW_ADDR_END);
      console.log('✅  Fix 2C: Ramo newaddress injectado no text handler.');
      changed++;
    }
  }
}

// ── Guarda resultado ─────────────────────────────────────────────────────────
if (changed === 0) {
  console.log('\nℹ️   Nenhuma alteração aplicada — o ficheiro já pode estar actualizado.');
} else {
  const BACKUP_PATH = BOT_PATH + '.bak';
  fs.copyFileSync(BOT_PATH, BACKUP_PATH);
  console.log(`\n💾  Backup guardado : ${BACKUP_PATH}`);
  fs.writeFileSync(BOT_PATH, src, 'utf8');
  console.log(`✅  bot.js actualizado: ${BOT_PATH}`);
  console.log('\n🎉  Patch concluído! Reinicia o bot (Azure App Service / PM2).');
}
