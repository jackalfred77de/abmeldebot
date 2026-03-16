# SharePoint Setup — AbmeldeBot Ledger

## 1. Permissões necessárias no App Registration (Azure)

No Azure Portal → App Registration → API Permissions, adicionar:
- `Sites.ReadWrite.All` (Application)
- `Files.ReadWrite.All` (Application)
- `Mail.Send` (Application) ← já existente para email

Após adicionar → **Grant admin consent**.

---

## 2. Criar a lista "AbmeldeCases" no SharePoint

Acessar o site SharePoint → New → List → Blank list → Nome: **AbmeldeCases**

Depois adicionar as seguintes colunas (além da coluna "Title" padrão):

| Nome interno    | Tipo              | Obrigatório |
|-----------------|-------------------|-------------|
| ClientName      | Single line text  | ✓           |
| Email           | Single line text  | ✓           |
| Phone           | Single line text  |             |
| Service         | Choice: diy, full | ✓           |
| Bezirk          | Single line text  |             |
| BerlinAddress   | Single line text  |             |
| MoveOutDate     | Single line text  |             |
| NewAddress      | Multiple lines    |             |
| Nationality     | Single line text  |             |
| Language        | Choice: de, pt, en|             |
| Status          | Choice (ver abaixo)| ✓          |
| CreatedAt       | Date and Time     |             |
| LastUpdated     | Date and Time     |             |
| AbmeldungUrl    | Hyperlink         |             |
| VollmachtUrl    | Hyperlink         |             |
| IdFrontUrl      | Hyperlink         |             |
| IdBackUrl       | Hyperlink         |             |
| AnmeldungUrl    | Hyperlink         |             |
| Notes           | Multiple lines    |             |
| Timeline        | Multiple lines    |             |

**Choices para coluna Status:**
- created
- pdf_generated
- email_sent
- pending_review
- submitted_to_behoerde
- completed
- rejected
- on_hold
- cancelled

---

## 3. Obter os IDs necessários (via Graph Explorer)

Aceder: https://developer.microsoft.com/graph/graph-explorer

### SP_SITE_ID
```
GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{sitePath}

Exemplo para rafer.sharepoint.com/sites/buero:
GET https://graph.microsoft.com/v1.0/sites/rafer.sharepoint.com:/sites/buero
```
Copiar o campo `id` do resultado.

### SP_DRIVE_ID
```
GET https://graph.microsoft.com/v1.0/sites/{SP_SITE_ID}/drives
```
Procurar `"name": "Documents"` (ou "Dokumente") e copiar o campo `id`.

### SP_LIST_ID
```
GET https://graph.microsoft.com/v1.0/sites/{SP_SITE_ID}/lists?$filter=displayName eq 'AbmeldeCases'
```
Copiar o campo `id` da lista.

---

## 4. Criar pasta raiz no SharePoint

A pasta `Abmeldung/Cases` será criada automaticamente pelo bot na primeira execução.
Para criar manualmente: SharePoint → Documents → New Folder → "Abmeldung" → dentro → "Cases"

---

## 5. Estrutura resultante no SharePoint

```
Documents/
└── Abmeldung/
    └── Cases/
        ├── AB1234567890/
        │   ├── Abmeldung_AB1234567890.pdf
        │   ├── Vollmacht_AB1234567890.pdf   ← full service
        │   ├── id_frente.jpg
        │   ├── id_verso.jpg
        │   └── anmeldung_anterior.jpg       ← se fornecido
        └── AB9876543210/
            └── ...
```

---

## 6. Power Automate — Trigger em mudança de status

Criar um flow:
- Trigger: **When an item is modified** (SharePoint → AbmeldeCases)
- Condition: `Status` changed to `submitted_to_behoerde`
- Action: Send email notification / create task / etc.

---

## 7. Variáveis Railway

Após obter os IDs, configurar no Railway → Variables:
```
SP_SITE_ID=rafer.sharepoint.com,XXXX-XXXX,YYYY-YYYY
SP_DRIVE_ID=b!XXXXXXXXXXXXXXXXXXXXXXXXXXXX
SP_LIST_ID=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
SP_CASES_FOLDER=Abmeldung/Cases
```
