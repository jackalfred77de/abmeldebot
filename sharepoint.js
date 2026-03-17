// ─── sharepoint.js ─────────────────────────────────────────────────────────
// Módulo de integração SharePoint para o AbmeldeBot
// Gerencia: criação de pastas de casos, upload de ficheiros, lista de ledger
//
// Variáveis de ambiente necessárias (já existentes no bot):
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
//
// Novas variáveis:
//   SP_SITE_ID      — ID do site SharePoint (ver abaixo como obter)
//   SP_DRIVE_ID     — ID da drive (Documents library)
//   SP_LIST_ID      — ID da lista "AbmeldeCases"
//   SP_CASES_FOLDER — Caminho da pasta raiz no SharePoint, ex: "Abmeldung/Cases"
// ───────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

// ── Config ─────────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.GRAPH_TENANT_ID     || '';
const CLIENT_ID     = process.env.GRAPH_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || '';
const SITE_ID       = process.env.SP_SITE_ID          || '';
const DRIVE_ID      = process.env.SP_DRIVE_ID         || '';
const LIST_ID       = process.env.SP_LIST_ID          || '';
const CASES_FOLDER  = process.env.SP_CASES_FOLDER     || 'Abmeldung/Cases';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// ── Token cache ─────────────────────────────────────────────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExpiry - 60000) return _token;

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
  });
  const resp = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  _token = resp.data.access_token;
  _tokenExpiry = now + (resp.data.expires_in * 1000);
  return _token;
}

function headers(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

// ── Verificar se SharePoint está configurado ────────────────────────────────
function isConfigured() {
  return !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET && SITE_ID && DRIVE_ID);
}

// ── Criar pasta do caso no SharePoint ──────────────────────────────────────
// Cria: {CASES_FOLDER}/{orderId}/
async function createCaseFolder(orderId) {
  const token = await getToken();
  const folderPath = `${CASES_FOLDER}/${orderId}`;

  // Garante que a pasta raiz existe
  try {
    await axios.post(
      `${GRAPH}/drives/${DRIVE_ID}/root:/${CASES_FOLDER}:/children`,
      { name: orderId, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      { headers: headers(token), timeout: 15000 }
    );
  } catch (e) {
    // 409 = já existe — ok
    if (!e.response || e.response.status !== 409) throw e;
  }

  console.log(`📁 SP: Pasta criada: ${folderPath}`);
  return folderPath;
}

// ── Upload de ficheiro para a pasta do caso ─────────────────────────────────
async function uploadFile(orderId, localPath, filename) {
  if (!fs.existsSync(localPath)) {
    console.warn(`⚠️ SP upload: ficheiro não encontrado: ${localPath}`);
    return null;
  }
  const token    = await getToken();
  const fileData = fs.readFileSync(localPath);
  const spPath   = `${CASES_FOLDER}/${orderId}/${filename}`;

  // Para ficheiros < 4MB usar upload simples
  const resp = await axios.put(
    `${GRAPH}/drives/${DRIVE_ID}/root:/${spPath}:/content`,
    fileData,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      timeout: 60000,
      maxBodyLength: 10 * 1024 * 1024,
    }
  );
  console.log(`☁️  SP: Upload OK: ${spPath}`);
  return resp.data.webUrl || null;
}

// ── Upload de imagem base64 para a pasta do caso ────────────────────────────
async function uploadBase64(orderId, base64Data, filename) {
  if (!base64Data) return null;
  const token = await getToken();

  // base64Data pode ser "data:image/jpeg;base64,XXXX" ou só "XXXX"
  const raw    = base64Data.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(raw, 'base64');
  const spPath = `${CASES_FOLDER}/${orderId}/${filename}`;

  const resp = await axios.put(
    `${GRAPH}/drives/${DRIVE_ID}/root:/${spPath}:/content`,
    buffer,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      timeout: 60000,
      maxBodyLength: 10 * 1024 * 1024,
    }
  );
  console.log(`☁️  SP: Upload base64 OK: ${spPath}`);
  return resp.data.webUrl || null;
}

// ── Criar item na lista SharePoint (ledger) ─────────────────────────────────
// A lista "AbmeldeCases" deve ter as colunas abaixo (criar manualmente ou via script)
async function createLedgerEntry(session, fileUrls = {}) {
  if (!LIST_ID) {
    console.log('ℹ️  SP: SP_LIST_ID não configurado — ledger pulado');
    return null;
  }
  const token = await getToken();
  const { data } = session;

  const now = new Date().toISOString();

  const item = {
    fields: {
      Title:        data.orderId,                          // OrderId (coluna padrão)
      ClientName:   `${data.firstName} ${data.lastName}`,
      Email:        data.email         || '',
      Phone:        data.phone         || '',
      Service:      data.service       || '',              // 'diy' | 'full'
      Bezirk:       data.bezirk        || '',
      BerlinAddress:data.fullAddress   || '',
      MoveOutDate:  data.moveOutDate   || '',
      NewAddress:   data.newFullAddress|| '',
      Nationality:  data.nationality   || '',
      Gender:       data.gender        || '',
      FamilyMembers: JSON.stringify(data.familyMembers || []),
      Language:     session.lang       || '',
      ChatId:       String(session.chatId || ''),
      Status:       'email_sent',
      CreatedAt:    now,
      LastUpdated:  now,
      AbmeldungUrl: fileUrls.abmeldung || '',
      VollmachtUrl: fileUrls.vollmacht || '',
      IdFrontUrl:   fileUrls.idFront   || '',
      IdBackUrl:    fileUrls.idBack    || '',
      AnmeldungUrl: fileUrls.anmeldung || '',
      DeliveryMethod: data.deliveryMethod || 'email',
      PostalAddress:  data.postalAddress  || '',
      PostalFee:      data.postalFee      || 0,
      ShippingCost:   0,
      TotalPrice:     data.totalPrice     || 0,
      AbmeldebestaetigungUrl: '',
      Notes:        '',
      // Timeline como JSON string (SharePoint não suporta arrays nativamente)
      Timeline: JSON.stringify([
        { ts: now, status: 'created',      note: 'Bot: dados coletados e PDFs gerados' },
        { ts: now, status: 'email_sent',   note: `Email enviado para ${data.email}` },
        { ts: now, status: 'pending_review', note: 'Aguardando revisão do escritório' },
      ]),
    }
  };

  const resp = await axios.post(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items`,
    item,
    { headers: headers(token), timeout: 15000 }
  );
  console.log(`📋 SP: Ledger entry criada: ${data.orderId} → ID ${resp.data.id}`);
  return resp.data.id;
}

// ── Atualizar status de um caso no ledger ───────────────────────────────────
async function updateCaseStatus(orderId, newStatus, note = '') {
  if (!LIST_ID) return null;
  const token = await getToken();

  // Buscar item pelo orderId
  const search = await axios.get(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items?$filter=fields/Title eq '${orderId}'&$expand=fields`,
    { headers: headers(token), timeout: 15000 }
  );
  const items = search.data.value;
  if (!items || items.length === 0) {
    console.warn(`⚠️ SP: Case ${orderId} não encontrado no ledger`);
    return null;
  }

  const itemId  = items[0].id;
  const current = items[0].fields;
  const now     = new Date().toISOString();

  // Adicionar entrada ao timeline
  let timeline = [];
  try { timeline = JSON.parse(current.Timeline || '[]'); } catch (_) {}
  timeline.push({ ts: now, status: newStatus, note });

  await axios.patch(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items/${itemId}/fields`,
    {
      Status:      newStatus,
      LastUpdated: now,
      Timeline:    JSON.stringify(timeline),
      Notes:       note || current.Notes || '',
    },
    { headers: headers(token), timeout: 15000 }
  );
  console.log(`🔄 SP: Status ${orderId} → ${newStatus}`);
  return itemId;
}

// ── Upload de foto do Telegram para o SharePoint ────────────────────────────
async function uploadTelegramPhoto(orderId, fileId, filename, telegramBot) {
  try {
    const fileLink = await telegramBot.telegram.getFileLink(fileId);
    const resp     = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 30000 });
    const token    = await getToken();
    const spPath   = `${CASES_FOLDER}/${orderId}/${filename}`;

    const uploadResp = await axios.put(
      `${GRAPH}/drives/${DRIVE_ID}/root:/${spPath}:/content`,
      Buffer.from(resp.data),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'image/jpeg',
        },
        timeout: 60000,
        maxBodyLength: 10 * 1024 * 1024,
      }
    );
    console.log(`☁️  SP: Telegram photo OK: ${spPath}`);
    return uploadResp.data.webUrl || null;
  } catch (e) {
    console.error(`⚠️ SP uploadTelegramPhoto error: ${e.message}`);
    return null;
  }
}

// ── Função principal: processar caso completo no SharePoint ─────────────────
async function processCaseToSharePoint(session, pdfPath, vollmachtPath, bot) {
  if (!isConfigured()) {
    console.log('ℹ️  SP: SharePoint não configurado — pulando integração');
    return null;
  }

  const { data } = session;
  const orderId  = data.orderId;
  const fileUrls = {};

  try {
    // 1. Criar pasta do caso
    await createCaseFolder(orderId);

    // 2. Upload PDFs gerados
    if (pdfPath && fs.existsSync(pdfPath)) {
      fileUrls.abmeldung = await uploadFile(orderId, pdfPath, `Abmeldung_${orderId}.pdf`);
    }
    if (vollmachtPath && fs.existsSync(vollmachtPath)) {
      fileUrls.vollmacht = await uploadFile(orderId, vollmachtPath, `Vollmacht_${orderId}.pdf`);
    }

    // 3. Upload fotos de documentos (via Telegram file_id → SharePoint)
    if (data.idFrontFileId && bot) {
      fileUrls.idFront = await uploadTelegramPhoto(orderId, data.idFrontFileId, 'id_frente.jpg', bot);
    } else if (data.idFrontImage) {
      fileUrls.idFront = await uploadBase64(orderId, data.idFrontImage, 'id_frente.jpg');
    }
    if (data.idBackFileId && bot) {
      fileUrls.idBack  = await uploadTelegramPhoto(orderId, data.idBackFileId, 'id_verso.jpg', bot);
    } else if (data.idBackImage) {
      fileUrls.idBack  = await uploadBase64(orderId, data.idBackImage, 'id_verso.jpg');
    }
    if (data.anmeldungFileId && bot) {
      fileUrls.anmeldung = await uploadTelegramPhoto(orderId, data.anmeldungFileId, 'anmeldung_anterior.jpg', bot);
    }

    // Upload documentos dos familiares
    const familyMembers = data.familyMembers || [];
    for (let i = 0; i < familyMembers.length; i++) {
      const fm = familyMembers[i];
      if (!fm || typeof fm !== 'object') continue;
      const num = i + 2;
      if (fm.docFrontFileId && bot) {
        fileUrls[`family${num}DocFront`] = await uploadTelegramPhoto(orderId, fm.docFrontFileId, `familiar${num}_doc_frente.jpg`, bot);
      } else if (fm.docFrontImage) {
        fileUrls[`family${num}DocFront`] = await uploadBase64(orderId, fm.docFrontImage, `familiar${num}_doc_frente.jpg`);
      }
      if (fm.docBackFileId && bot) {
        fileUrls[`family${num}DocBack`] = await uploadTelegramPhoto(orderId, fm.docBackFileId, `familiar${num}_doc_verso.jpg`, bot);
      } else if (fm.docBackImage) {
        fileUrls[`family${num}DocBack`] = await uploadBase64(orderId, fm.docBackImage, `familiar${num}_doc_verso.jpg`);
      }
    }

    // 4. Criar entrada no ledger
    const listItemId = await createLedgerEntry(session, fileUrls);

    console.log(`✅ SP: Caso ${orderId} processado. List item: ${listItemId}`);
    return { orderId, fileUrls, listItemId };

  } catch (e) {
    console.error(`❌ SP processCaseToSharePoint error: ${e.message}`);
    // Não é fatal — o bot continua mesmo se SharePoint falhar
    return null;
  }
}

// ── Listar todos os casos da lista SharePoint ───────────────────────────────
async function listCases(filter = '') {
  if (!LIST_ID) {
    console.log('ℹ️  SP: SP_LIST_ID não configurado — listCases pulado');
    return [];
  }
  const token = await getToken();
  let url = `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=200&$orderby=fields/CreatedAt desc`;
  if (filter) url += `&$filter=${filter}`;

  const allItems = [];
  while (url) {
    const resp = await axios.get(url, { headers: headers(token), timeout: 30000 });
    const items = (resp.data.value || []).map(item => ({
      id: item.id,
      ...item.fields,
    }));
    allItems.push(...items);
    url = resp.data['@odata.nextLink'] || null;
  }
  console.log(`📋 SP: listCases → ${allItems.length} items`);
  return allItems;
}

// ── Obter um caso específico pelo orderId ────────────────────────────────────
async function getCase(orderId) {
  if (!LIST_ID) return null;
  const token = await getToken();
  const resp = await axios.get(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items?$filter=fields/Title eq '${orderId}'&$expand=fields&$top=1`,
    { headers: headers(token), timeout: 15000 }
  );
  const items = resp.data.value;
  if (!items || items.length === 0) return null;
  return { id: items[0].id, ...items[0].fields };
}

// ── Adicionar nota ao timeline de um caso ────────────────────────────────────
async function addCaseNote(orderId, note) {
  if (!LIST_ID || !note) return null;
  const token = await getToken();

  const search = await axios.get(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items?$filter=fields/Title eq '${orderId}'&$expand=fields`,
    { headers: headers(token), timeout: 15000 }
  );
  const items = search.data.value;
  if (!items || items.length === 0) return null;

  const itemId  = items[0].id;
  const current = items[0].fields;
  const now     = new Date().toISOString();

  let timeline = [];
  try { timeline = JSON.parse(current.Timeline || '[]'); } catch (_) {}
  timeline.push({ ts: now, status: current.Status || 'note', note });

  await axios.patch(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items/${itemId}/fields`,
    {
      LastUpdated: now,
      Timeline:    JSON.stringify(timeline),
      Notes:       note,
    },
    { headers: headers(token), timeout: 15000 }
  );
  console.log(`📝 SP: Nota adicionada a ${orderId}`);
  return itemId;
}

// ── Atualizar campos arbitrários de um caso no ledger ─────────────────
async function updateCaseField(orderId, fieldsToUpdate = {}) {
  if (!LIST_ID) return null;
  const token = await getToken();
  const search = await axios.get(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items?$filter=fields/Title eq '${orderId}'&$expand=fields`,
    { headers: headers(token), timeout: 15000 }
  );
  const items = search.data.value;
  if (!items || items.length === 0) throw new Error(`Case ${orderId} not found`);
  const itemId = items[0].id;
  const now = new Date().toISOString();
  await axios.patch(
    `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items/${itemId}/fields`,
    { ...fieldsToUpdate, LastUpdated: now },
    { headers: headers(token), timeout: 15000 }
  );
  console.log(`🔧 SP: Fields updated for ${orderId}:`, Object.keys(fieldsToUpdate).join(', '));
  return itemId;
}

// ── DSGVO: Fall komplett löschen (Listeneintrag + Ordner) ─────────────────
async function deleteCase(orderId) {
  if (!isConfigured()) throw new Error('SharePoint not configured');
  const token = await getToken();

  // 1. Delete list item (if LIST_ID configured)
  if (LIST_ID) {
    try {
      const search = await axios.get(
        `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items?$filter=fields/Title eq '${orderId}'&$expand=fields`,
        { headers: headers(token), timeout: 15000 }
      );
      const items = search.data.value;
      if (items && items.length > 0) {
        await axios.delete(
          `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items/${items[0].id}`,
          { headers: headers(token), timeout: 15000 }
        );
        console.log(`🗑 SP: List item deleted for ${orderId}`);
      }
    } catch (e) {
      console.error(`⚠️ SP deleteCase list error: ${e.message}`);
    }
  }

  // 2. Delete folder with all files
  try {
    await axios.delete(
      `${GRAPH}/drives/${DRIVE_ID}/root:/${CASES_FOLDER}/${orderId}`,
      { headers: headers(token), timeout: 30000 }
    );
    console.log(`🗑 SP: Folder deleted: ${CASES_FOLDER}/${orderId}`);
  } catch (e) {
    if (e.response && e.response.status === 404) {
      console.log(`ℹ️ SP: Folder ${orderId} not found (already deleted?)`);
    } else {
      console.error(`⚠️ SP deleteCase folder error: ${e.message}`);
      throw e;
    }
  }

  console.log(`✅ SP DSGVO: Case ${orderId} fully deleted`);
  return true;
}

module.exports = {
  isConfigured,
  createCaseFolder,
  uploadFile,
  uploadBase64,
  uploadTelegramPhoto,
  createLedgerEntry,
  updateCaseStatus,
  updateCaseField,
  processCaseToSharePoint,
  listCases,
  getCase,
  addCaseNote,
  deleteCase,
};
