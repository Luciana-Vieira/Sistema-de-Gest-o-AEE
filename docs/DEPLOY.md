# Publicar o sistema

O servidor é um único processo Node que precisa de **uma pasta persistente** (`DATA_DIR`) e de **HTTPS** na frente. Qualquer opção abaixo serve; escolha uma.

## Antes de publicar (checklist)

- [ ] Domínio apontado para o servidor (ex.: `app.seudominio.com.br`).
- [ ] `.env` com `NODE_ENV=production`, `BASE_URL=https://app.seudominio.com.br` e `TRUST_PROXY=true` se houver proxy na frente.
- [ ] `DATA_DIR` num disco persistente (volume) **com backup diário**.
- [ ] `ALLOW_SIGNUP` decidido: `false` (você cria cada organização com `create-owner`) ou `true` (cadastro aberto).
- [ ] Google Agenda configurado (opcional, abaixo).
- [ ] Organização criada com `npm run create-owner` e primeiro acesso feito (a senha provisória é trocada no login).
- [ ] Termos de uso e política de privacidade publicados (os dados são de crianças e famílias; LGPD).

## Opção 1: Docker (recomendada)

```bash
cp .env.example .env      # edite BASE_URL, NODE_ENV=production, TRUST_PROXY=true…
docker compose up -d --build
docker compose exec app npm run create-owner -- --slug minha-escola --org "Minha Escola" --nome "Seu Nome" --email voce@exemplo.com
```

A imagem roda `npm run migrate` a cada início, guarda os dados no volume `vertice-data` e expõe a porta 3000. Coloque um proxy com HTTPS na frente (Opção 2, passo 4) ou use a plataforma de hospedagem.

Atualizar para uma versão nova: `git pull` (ou copiar os arquivos) e `docker compose up -d --build`.

## Opção 2: servidor Linux (VPS) sem Docker

1. Instale o Node 22 LTS (ex.: <https://github.com/nodesource/distributions>) e crie um usuário sem privilégios.
2. Copie o projeto para `/opt/vertice` e rode:
   ```bash
   npm ci --omit=dev && npm run build && npm run migrate
   ```
3. Crie o serviço `/etc/systemd/system/vertice.service`:
   ```ini
   [Unit]
   Description=Vertice Gestao
   After=network.target

   [Service]
   User=vertice
   WorkingDirectory=/opt/vertice
   ExecStart=/usr/bin/npm start
   Restart=always
   EnvironmentFile=/opt/vertice/.env

   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now vertice`
4. HTTPS com Caddy (`/etc/caddy/Caddyfile`), que emite o certificado sozinho:
   ```
   app.seudominio.com.br {
       reverse_proxy 127.0.0.1:3000
   }
   ```
   Com Nginx, lembre de repassar o WebSocket (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

## Opção 3: plataformas (Render, Railway, Fly.io)

- Use o `Dockerfile` do projeto.
- Crie um **disco/volume persistente** montado em `/data` (sem isso, os dados somem a cada publicação).
- Variáveis: as do `.env.example`, com `DATA_DIR=/data`, `NODE_ENV=production`, `TRUST_PROXY=true` e `BASE_URL` com o endereço https da plataforma ou do seu domínio.
- Rode o `create-owner` pelo console/shell da plataforma.
- Mantenha **uma única instância** (o SQLite e o tempo real ficam em memória e disco de um processo). Para várias instâncias, veja “Trocar SQLite por PostgreSQL” em ARQUITETURA.md.

## Google Agenda e Meet (opcional)

1. Em <https://console.cloud.google.com>, crie um projeto e ative a **Google Calendar API**.
2. Em *Tela de consentimento OAuth*, configure o app (tipo externo), com os escopos `.../auth/calendar.events`, `openid` e `email`. Enquanto o app estiver em teste, só os e-mails cadastrados como testadores conseguem conectar; para todos os clientes, envie o app para verificação do Google (o escopo de agenda é “sensível”).
3. Em *Credenciais*, crie um **ID do cliente OAuth** do tipo *Aplicativo da Web* com o URI de redirecionamento autorizado:
   `https://app.seudominio.com.br/oauth/google/callback` (o mesmo `BASE_URL` + `/oauth/google/callback`).
4. Preencha no `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `TOKEN_ENC_KEY` (gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). **Guarde a `TOKEN_ENC_KEY`**: sem ela, as conexões já feitas precisam ser refeitas.
5. Reinicie. Cada pessoa da equipe entra em **Conta e equipe › Google Agenda › Conectar**.

## Backup e restauração

Tudo fica em `DATA_DIR`:

```
data/vertice.sqlite   (+ vertice.sqlite-wal e -shm enquanto roda)
data/assets/          arquivos enviados
data/templates/       modelos Word próprios
```

Backup consistente com o servidor ligado:

```bash
npm run backup                      # cria ../backups/<data-hora>/ ao lado de DATA_DIR
npm run backup -- --dir /mnt/backup # ou numa pasta escolhida
# no Docker: docker compose exec app npm run backup -- --dir /data/backups
```

O comando copia o banco (`VACUUM INTO`, seguro com o sistema em uso), os arquivos enviados e os modelos Word. Agende com o `cron` (ex.: todo dia às 3h).

Guarde as cópias fora do servidor (S3, Backblaze, Google Drive…) e teste a restauração de vez em quando: pare o serviço, coloque os arquivos de volta em `DATA_DIR` e inicie.

## Fontes locais (opcional)

As telas carregam a fonte Montserrat do Google Fonts. Para não depender dele, baixe os arquivos da fonte para `public/static/fonts/`, crie um `@font-face` e troque os `<link … fonts.googleapis.com …>` em `client/src/*.src.html` e `server/pages.js`; depois rode `npm run build`.

## Monitoramento

- `GET /healthz` responde `{"ok":true}`.
- Os erros do servidor saem no log padrão (`docker compose logs -f` ou `journalctl -u vertice -f`).
