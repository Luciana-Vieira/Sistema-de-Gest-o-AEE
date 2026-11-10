# Arquitetura

## Visão geral

```
 Navegador                                         Servidor Node.js (um processo)
┌──────────────────────────────────────┐          ┌───────────────────────────────────────────────┐
│ public/app.html                       │  HTTPS   │ Express                                       │
│  ├─ Gestão (client/src/gestao)        │ ───────► │  ├─ páginas: /login /signup /w/<org>/conta    │
│  ├─ Planner  (módulo embutido)        │  REST    │  ├─ /w/<org>/  → app.html + VX_CONFIG         │
│  └─ Lousa Viva (módulo embutido)      │          │  ├─ /api/t/<org>/db, /me, /users, /assets,    │
│                                       │          │  │   /team, /org, /template, /google          │
│ static/claude-compat.js               │  WSS     │  ├─ /_blob/<id>  arquivos enviados            │
│  window.claude.use("db"|"user"|…)     │ ◄──────► │  └─ /ws  assinaturas + sala da Lousa          │
└──────────────────────────────────────┘          │                                               │
                                                   │ SQLite (DATA_DIR/vertice.sqlite)              │
                                                   │ Arquivos (DATA_DIR/assets/<org>/<id>)         │
                                                   │ Modelos Word (DATA_DIR/templates/<org>.docx)  │
                                                   └───────────────┬───────────────────────────────┘
                                                                   │ HTTPS (opcional)
                                                                   ▼
                                                     Google OAuth + Google Calendar API
```

O sistema nasceu como um artefato do Claude: uma página única que usa o ambiente do Claude para guardar dados, saber quem está logado, sincronizar em tempo real e enviar arquivos. Para sair do Claude **sem reescrever as telas**, a migração manteve o código das telas quase igual e trocou o que estava por baixo:

1. `public/static/claude-compat.js` cria um objeto `window.claude` com a mesma interface que o Claude oferecia (`use("db")`, `use("user")`, `use("room")`, `use("assets")`, `use("downloads")`, `use("mcp")`), mas que conversa com este servidor.
2. O servidor implementa o armazenamento, as contas, as regras de acesso, o tempo real, os arquivos e a integração com o Google.

Com isso, as telas funcionam do mesmo jeito e você pode evoluir para um front-end novo (React, Vue…) aos poucos, usando a mesma API.

## Front-end

- **Sem framework e sem etapa de compilação de JavaScript.** Cada módulo é um arquivo HTML com estilos e código.
- `client/build.js` (Node + PostCSS) junta Gestão, Planner e Lousa em `public/app.html`:
  - isola o CSS de cada módulo (prefixos `#mod-planner`, `#mod-lousa` e `:where(#gx)`) para um não afetar o outro;
  - transforma Planner e Lousa em funções `__vxPlanner(ROOT)` / `__vxLousa(ROOT)` que a Gestão abre no menu;
  - renomeia as coleções dos módulos (`pl_boards`, `pl_cards`, `lv_boards`, `lv_ink`, `lv_acesso`);
  - acrescenta o cabeçalho do documento, o ponto de injeção `<!--VX_CONFIG-->` e o `<script src="/static/claude-compat.js">`.
- Ao servir a página, o servidor injeta `window.VX_CONFIG` (organização, marca, modo, pessoa logada, link do portal) e troca os campos `{{ORG_NOME}}`, `{{ORG_MARCA1}}`, `{{ORG_MARCA2}}` e `{{ORG_SUBTITULO}}` pela marca da organização.
- Bibliotecas externas: **JSZip** (gera os arquivos Word; servido pelo próprio servidor a partir do pacote npm) e a fonte **Montserrat** (Google Fonts; pode ser hospedada localmente, ver DEPLOY).
- Modos da página (decididos no carregamento, como no Claude):
  - **equipe** (gestão e professores): todas as telas;
  - **aluno**: só a Lousa Viva, em tela cheia;
  - **família** (`/w/<org>/familia`): Portal da Família com código de acesso, sem login.

## Back-end

| Arquivo | Responsabilidade |
|---|---|
| `server/index.js` | Express: cabeçalhos de segurança, páginas, API REST, arquivos, erros |
| `server/realtime.js` | WebSocket `/ws`: assinaturas de documentos e coleções, sala da Lousa (traço ao vivo, laser, presença) |
| `server/store.js` | Lê e grava documentos JSON e avisa o tempo real a cada mudança |
| `server/rules.js` | Regras de acesso por caminho e papel |
| `server/auth.js` | Contas, bcrypt, sessões em cookie HttpOnly, organizações, papéis, limite de tentativas |
| `server/google.js` | OAuth do Google, tokens criptografados (AES-256-GCM), criação de evento com Meet |
| `server/pages.js` + `public/static/conta.js` | Páginas de login, cadastro, troca de senha e Conta e equipe |
| `server/db.js` | Conexão SQLite (`node:sqlite`), migrações e transações |

Dependências npm: `express`, `ws`, `bcryptjs`, `jszip`, `postcss`. Nenhuma tem código nativo.

## Banco de dados

Tabelas (ver `migrations/001_init.sql`):

| Tabela | Conteúdo |
|---|---|
| `tenants` | Organizações (escolas/professores): endereço (`slug`), nome e marca/dados (`settings` JSON) |
| `users` | Contas: e-mail, nome, hash bcrypt, indicador de senha provisória |
| `memberships` | Papel de cada conta em cada organização: `gestor`, `equipe`, `aluno`, `familia` |
| `sessions` | Sessões de login (só o hash SHA-256 do token fica no banco) |
| `docs` | **Todos os dados do sistema**, como documentos JSON: `tenant_id`, `path`, `parent`, `id`, `data`, `version`, `updated_at`, `updated_by` |
| `assets` | Metadados dos arquivos enviados (o conteúdo fica em `DATA_DIR/assets`) |
| `google_tokens`, `oauth_states` | Integração com o Google (tokens criptografados) |

### Coleções (dentro de `docs`)

O sistema guarda os dados no mesmo formato de documentos do Claude: o caminho `colecao/id` identifica um registro, e subcoleções usam `colecao/id/sub/id2`. Principais coleções:

| Coleção | Registro | Campos principais |
|---|---|---|
| `leads` | Interessado | nome, responsavel, telefone, email, origem, interesse, status, dataEntrada, interacoes[], historico[] |
| `alunos` | Aluno matriculado | nome, dataNascimento, escola, anoEscolar, curso, horarios[], mensalidade (centavos), diaVencimento, responsavelNome/Cpf/Rg/Parentesco, telefone, email, endereco, situacao, contratoNumero, historico[] |
| `aulas` | Aula na agenda | alunoId, data, inicio, fim, profissional, modalidade, linkReuniao, googleEventId, situacao, tema, observacoes, casa, aval{eng,comp,aut}, naoCompartilhar |
| `reunioes` | Reunião com lead | leadId, data, inicio, fim, modalidade, linkReuniao, googleEventId, pauta, resumo, situacao |
| `avaliacoes` | Avaliação de evolução | alunoId, data, tipo, periodo, niveis{indicador: 1–4}, avancos, atencao, proximos, publicacao |
| `boletins` | Boletim escolar | alunoId, disciplina, periodo, atividades[{tipo,data,valor,nota}], media, notaGeral, pontosFortes, aDesenvolver, publicacao |
| `pdis` | Plano de Desenvolvimento Individual | alunoId, status, objetivos[], versoes[] (cópias congeladas), revisaoEm |
| `lancamentos` | Receita ou despesa | tipo, descricao, valor (centavos), categoria, data, competencia, situacao, alunoId, forma |
| `acervo` | Livro/jogo/material | registro, titulo, autor, tema, idade, resumo, emprestimo{…}, emprestimos[] |
| `anexos` | Documento do aluno | alunoId, categoria, titulo, assetId, arquivoNome, contentType, tamanho |
| `familias` | Acesso de um responsável ao portal | nome, parentesco, alunoIds[], token, ativo, incluirAulas, sincronizadoEm |
| `portal/<token>/pub/dados` | O que a família vê (gerado pela equipe) | alunos[{avaliações publicadas, boletins, aulas, próximas aulas}] |
| `ajustes/geral` | Ajustes da organização | cursos, origens, categorias, equipe, indicadores, assinatura, contrato{…}, cobranca{…} |
| `pl_boards`, `pl_cards` | Planner | quadros, listas, sprints, cartões, comentários, anexos |
| `lv_boards`, `lv_ink/<pessoa>/boards/<tela>/els/<elemento>`, `lv_acesso/turma` | Lousa Viva | telas, tinta de cada pessoa, marcador de acesso da turma |
| `sistema/equipe` | Marcador interno | indica que a equipe já abriu o sistema |

Valores em dinheiro são inteiros em centavos. Datas são texto `AAAA-MM-DD`; momentos são ISO 8601.

### Trocar SQLite por PostgreSQL

O acesso ao banco está concentrado em `server/db.js`, `server/store.js` e `server/auth.js`. Para PostgreSQL:
1. troque `node:sqlite` por `pg` (`Pool`) em `db.js` e torne as funções assíncronas;
2. use `JSONB` na coluna `data` e `ON CONFLICT … DO UPDATE` (a sintaxe é a mesma);
3. para vários servidores ao mesmo tempo, o aviso de mudanças (`store.bus`) e a sala da Lousa precisam passar por um canal comum (PostgreSQL `LISTEN/NOTIFY` ou Redis pub/sub), e os arquivos devem ir para um armazenamento de objetos (S3, R2, GCS) em vez do disco.

## Regras de acesso

Níveis: `familia` = ver, `aluno` = interagir, `equipe` = administrar, `gestor` = administrar + equipe/organização. Vale a regra mais específica (`server/rules.js`):

| Caminho | Ler | Gravar |
|---|---|---|
| tudo (padrão) | equipe | equipe |
| `portal/…` | família com conta; **qualquer pessoa lê um documento** se souber o código (16 caracteres aleatórios) | equipe |
| `lv_boards/…`, `lv_ink/…` | família com conta | equipe |
| `lv_ink/<a própria pessoa>/…` | família com conta | aluno (a própria tinta) |
| `lv_acesso/…` | aluno | equipe |

Na sala da Lousa, alunos podem enviar `risco` (traço ao vivo) e `laser`; os demais tópicos (como “chamar a turma”) são só da equipe. As telas da Lousa também têm a própria lista de quem vê e quem escreve, controlada pelo professor dentro da Lousa.

Somente a gestão altera `Conta e equipe`, os dados da organização e o modelo Word.

## API

Todas as rotas `/api/*` exigem o cabeçalho `X-VX: 1` (impede chamadas de outros sites) e usam o cookie de sessão. Erros voltam como `{ "code": "...", "message": "..." }`.

| Método e rota | Uso |
|---|---|
| `GET /api/t/:org/db/doc?path=` | Lê um documento → `{exists, data}` |
| `GET /api/t/:org/db/col?path=` | Lê uma coleção → `{docs:[{id,data}]}` |
| `POST /api/t/:org/db/write` | `{op:"set"|"update"|"delete", path, data}` |
| `GET /api/t/:org/me` | Quem está logado e o papel |
| `POST /api/t/:org/users/profiles` | `{ids:[…]}` → nomes, cores e avatares |
| `GET /api/t/:org/users/search?q=` | Pessoas da organização |
| `POST /api/t/:org/assets` | Envia arquivo (corpo binário; `Content-Type` e `X-Filename`) → `{id, url}` |
| `DELETE /api/t/:org/assets/:id` | Exclui arquivo (quem enviou ou equipe) |
| `GET /_blob/:id` | Baixa o arquivo (só membros da organização) |
| `GET/POST/PATCH/DELETE /api/t/:org/team…` | Equipe e acessos (gestão) |
| `PUT /api/t/:org/org` | Dados e marca da organização (gestão) |
| `PUT/DELETE /api/t/:org/template`, `GET …/template/status` | Modelo Word próprio (gestão) |
| `GET /api/t/:org/google/status`, `POST …/google/disconnect`, `POST …/google/create-event` | Google Agenda |
| `POST /api/me/password` | Troca a própria senha |
| `GET /healthz` | Verificação de saúde |

### Tempo real (`/ws?t=<org>`)

Mensagens JSON. Do navegador: `{t:"sub", sid, kind:"doc"|"col", path}`, `{t:"unsub", sid}`, `{t:"emit", rid, topic, data}`, `{t:"presence", patch}`, `{t:"peers"}`. Do servidor: `snap` (coleção inteira), `chg` (um documento mudou; `data:null` = apagado), `doc`, `err`, `ack`, `room` (mensagem da sala) e `peers` (quem está presente). A camada de compatibilidade transforma isso nos objetos `onSnapshot`, `docChanges()`, `room.on`, `room.onPeers` que o código das telas espera.

## Segurança

- Senhas com bcrypt (custo 12); sessões com token aleatório de 256 bits, cookie `HttpOnly`, `SameSite=Lax` e `Secure` quando `BASE_URL` é https.
- Limite de tentativas no login, no cadastro e na leitura anônima do portal.
- Pedidos que alteram dados exigem a mesma origem e o cabeçalho `X-VX`.
- Cabeçalhos: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` e HSTS em https. Arquivos enviados são servidos com `Content-Security-Policy: sandbox` e só para membros da organização.
- Cada organização só enxerga os próprios documentos e arquivos (todas as consultas filtram por `tenant_id`).
- Tokens do Google criptografados com `TOKEN_ENC_KEY`.
- A CSP permite scripts inline porque as telas usam esse formato; ao migrar para um front-end novo, dá para retirar essa permissão.
