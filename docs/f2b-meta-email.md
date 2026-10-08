# F2b — Meta oficial (Messenger/Instagram) + e-mail SMTP/IMAP

OAuth da Meta por workspace (1 Página + IG vinculado), webhooks verificados
(Graph API v21+), mailbox por workspace (SMTP envio + IMAP recebimento com
polling), fila de saída com backoff. Tudo unificado no mesmo contato/inbox
(`src/intake.ts`).

## 1. Meta oficial

### 1.1 Criar o app

1. Em `developers.facebook.com`, crie um app (tipo **Empresa**) e adicione os
   produtos **Messenger** e **Instagram**.
2. Anote **App ID** e **App Secret** → `META_APP_ID` / `META_APP_SECRET`.
3. Invente um token de verificação → `META_VERIFY_TOKEN` (mesmo valor colado
   no painel da Meta e no env do core).
4. `META_REDIRECT_URI`: URL pública do core que recebe o OAuth
   (ex.: `https://crm.exemplo.com/meta/callback`).

### 1.2 Assinar o webhook

Na configuração do webhook do app (produto Messenger e/ou Instagram):

- URL de callback: `https://<core>/webhooks/meta`
- Token de verificação: o mesmo `META_VERIFY_TOKEN`
- Campos assinados: `messages`, `messaging_postbacks` (Página);
  `messages` (Instagram).

O core responde o `GET` de verificação com o `hub.challenge` e valida cada
`POST` via `X-Hub-Signature-256` (HMAC SHA-256 do corpo com o App Secret).
Sem `META_APP_SECRET` a verificação é pulada (só dev).

### 1.3 Conectar por workspace

Fluxo OAuth (produção):

1. `GET /workspaces/:id/meta/oauth-url` → abre no browser (state = workspace).
2. Usuário autoriza a Página → a Meta redireciona com `?code=…&state=<ws>`.
3. `POST /workspaces/:id/meta/connect { code, redirectUri? }` → o core troca
   o code, lista as Páginas, conecta a escolhida (`pageId` opcional no corpo)
   e detecta o IG vinculado (`instagram_business_account`).

Conexão manual (staging/testes):

`POST /workspaces/:id/meta/connect { pageId, pageName?, igUserId?, accessToken }`

O token da Página é cifrado (AES-256-GCM, chave do `JWT_SECRET`) antes de
persistir e **nunca** volta na API (`GET connection` devolve status/Página/IG
redigidos). Uma Página só pode estar em um workspace (`pagina_em_uso`).

### 1.4 Enviar e receber

- Entrada: webhook → `meta_page_index` resolve o workspace pela Página →
  intake (`channel` = `messenger` | `instagram`, `source` = `meta`,
  idempotente por `mid`). Ecos (`is_echo`) são ignorados.
- Saída: `POST /workspaces/:id/meta/send { conversationId, text }` cria a
  mensagem `saida` e enfileira; o processador entrega via Send API
  (`POST /v21.0/me/messages`, `messaging_type: RESPONSE`).

## 2. E-mail por workspace

### 2.1 Mailbox

`POST /workspaces/:id/mail/mailboxes` com remetente + credenciais SMTP/IMAP:

```json
{
  "name": "suporte",
  "fromEmail": "suporte@exemplo.com",
  "fromName": "Suporte",
  "smtpHost": "smtp.exemplo.com", "smtpPort": 587,
  "smtpUser": "suporte@exemplo.com", "smtpPass": "…",
  "imapHost": "imap.exemplo.com", "imapPort": 993,
  "imapUser": "suporte@exemplo.com", "imapPass": "…"
}
```

Senhas cifradas em repouso, nunca expostas (`GET` devolve tudo menos elas).
`PATCH` edita (inclusive troca de senha); `status: pausada` suspende envio e
recebimento. Envie e receba pela porta 587/STARTTLS (ou 465) e 993/TLS.

### 2.2 Envio (SMTP)

`POST /workspaces/:id/mail/send { mailboxId, to, subject, text, conversationId? }`
cria a mensagem `saida` (nova conversa `email` se não informada) e enfileira.
O processador envia via SMTP do mailbox e grava o `Message-ID` do provedor.

### 2.3 Recebimento (IMAP polling/IDLE)

`POST /workspaces/:id/mail/sync { mailboxId? }` lê UIDs novos, ingere cada
mensagem no intake (`channel` = `email`, `source` = `mail`, idempotente por
`Message-ID`) e avança `last_uid`. Em produção, ligue o polling automático
(`MAIL_SYNC_INTERVAL_MS`, ex. 300000) ou chame o sync por cron.

**IDLE**: o `imapflow` suporta `idle()`; o polling foi escolhido como padrão
por ser stateless (múltiplas réplicas sem coordenação) e suficiente para o
SLA do inbox. Evolução documentada: trocar `listNew` por um worker IDLE por
mailbox com reconexão — a interface `MailReceiver` não muda.

O parser atual cobre texto puro; anexos/HTML multipart viram texto corrido.

### 2.4 SPF, DKIM e DMARC (entregabilidade)

Sem esses três registros, provedores (Gmail/Outlook) marcam como spam ou
rejeitam. Configure no DNS do domínio remetente:

```
; SPF — autoriza o servidor SMTP a enviar pelo domínio
@  TXT  "v=spf1 include:_spf.exemplo.com ~all"

; DKIM — assinatura do provedor SMTP (publique a chave que ele gerar;
; seletor típico `crm` ou o indicado pelo provedor)
crm._domainkey  TXT  "v=DKIM1; k=rsa; p=<chave-publica>"

; DMARC — política + relatórios (comece em none, evolua para quarantine/reject)
_dmarc  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@exemplo.com; fo=1"
```

Checklist antes de ir para staging/prod:

1. `dig TXT <dominio>` e `dig TXT _dmarc.<dominio>` respondem.
2. Envie para `check-auth@verifier.port25.com` e confira `Authentication-Results:
   spf=pass, dkim=pass, dmarc=pass`.
3. `mail-tester.com` ≥ 9/10.
4. Reverse DNS (PTR) do IP de envio aponta para o hostname do SMTP.

## 3. Fila de saída com backoff

Toda resposta (`meta/send`, `mail/send`) cai em `outbound_queue` com status
`pendente`. O processador (`processWorkspaceOutbound`, também exposto em
`POST /workspaces/:id/outbound/process` e no ticker `OUTBOUND_TICK_MS`):

- sucesso → `enviado` (+ `provider_message_id`);
- erro → reagenda em `base * 2^attempts` (padrão 30s → teto 1h);
- após `OUTBOUND_MAX_ATTEMPTS` (padrão 8) → `falhou` com `last_error`.

`GET /workspaces/:id/outbound?status=` dá observabilidade por workspace.
**Isolamento**: o processador lista vencidos sempre dentro de um workspace;
nenhuma query cruza `workspace_id`.

## 4. Checklist staging (critério de aceite)

1. Conectar Página+IG no workspace A (OAuth ou manual) e mailbox no mesmo
   workspace; repetir com Página/mailbox diferentes no workspace B.
2. Enviar mensagem como cliente no Messenger/IG da Página A →
   aparece na inbox do workspace A (canal `messenger`/`instagram`).
3. Responder por `POST meta/send` → chega no Messenger/IG do cliente.
4. Enviar e-mail ao `fromEmail` do mailbox A → conversa `email` na inbox A;
   responder por `POST mail/send` → e-mail entregue.
5. Repetir 2–4 na Página/mailbox B → nada de B aparece em A e vice-versa
   (conversas, contatos, fila).
6. Reenviar o mesmo webhook/Message-ID → `duplicate`, sem mensagem extra.
7. Desligar o SMTP/IMAP (senha errada) → fila fica `pendente` com backoff e
   `last_error`; corrigir → `enviado` sem duplicar.
8. `GET connection`, `GET mailboxes` e `GET outbound` nunca expõem tokens ou
   senhas (nem cifrados).
