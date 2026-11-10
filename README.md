# Vértice Gestão (versão SaaS)

Sistema de gestão para aulas particulares e centros de apoio escolar: leads, alunos, agenda com aulas e reuniões on-line, avaliações e evolução, boletim escolar, PDI, financeiro com cobrança por Pix, acervo com empréstimos, Portal da Família, Planner de projetos e Lousa Viva (quadro colaborativo em tempo real).

Esta pasta tem o código completo para rodar o sistema **fora do Claude**, em um servidor próprio, com várias escolas ou professores (organizações) no mesmo servidor, cada um com os próprios dados, contas e marca.

| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Como o sistema é montado: front-end, back-end, banco, tempo real, API e segurança |
| [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) | O que cada módulo faz, papéis de acesso e campos do modelo Word |
| [docs/DEPENDENCIAS-CLAUDE.md](docs/DEPENDENCIAS-CLAUDE.md) | O que dependia do Claude e o que foi colocado no lugar |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Como publicar (Docker, servidor próprio ou plataforma), Google Agenda, backup e checklist |
| [docs/MIGRACAO-DE-DADOS.md](docs/MIGRACAO-DE-DADOS.md) | Como trazer os dados da versão do Claude |

---

## Pré-requisitos

- **Node.js 22.13 ou mais novo** (recomendado: Node 22 LTS ou 24). Confira com `node -v`.
  O banco usa o SQLite que já vem dentro do Node (`node:sqlite`); não é preciso instalar banco de dados nem compilar nada.
- **npm** (vem com o Node).
- Opcional: **Docker** 24+ com Docker Compose, para publicar em produção.
- Opcional: um projeto no **Google Cloud** com OAuth, para criar salas do Google Meet automaticamente.

Funciona em Linux, macOS e Windows.

## Começar em 5 minutos (computador local)

```bash
# 1. instalar as dependências
npm ci

# 2. configurar
cp .env.example .env          # no Windows (PowerShell): Copy-Item .env.example .env

# 3. montar o front-end (gera public/app.html)
npm run build

# 4. criar o banco
npm run migrate

# 5a. criar uma organização de demonstração com dados fictícios…
npm run seed
#     …ou 5b. criar a sua organização, vazia
npm run create-owner -- --slug minha-escola --org "Minha Escola" --nome "Seu Nome" --email voce@exemplo.com

# 6. iniciar
npm start
```

Abra <http://localhost:3000> e entre com o e-mail e a senha que o passo 5 mostrou no terminal (as senhas são geradas na hora e aparecem uma única vez; contas criadas pelo `create-owner` pedem a troca no primeiro acesso).

Endereços de cada organização:

| Endereço | Para quem |
|---|---|
| `/w/<endereço>/` | Equipe (gestão e professores) e alunos (Lousa Viva) |
| `/w/<endereço>/familia` | Portal da Família: entra só com o código de acesso, sem conta |
| `/w/<endereço>/conta` | Conta e equipe: pessoas e papéis, dados da organização, modelo Word, Google Agenda, senha |

## Comandos

| Comando | O que faz |
|---|---|
| `npm ci` | Instala as dependências exatamente como no `package-lock.json` |
| `npm run build` | Monta `public/app.html` a partir de `client/src/` (rode de novo sempre que mudar esses arquivos) |
| `npm run migrate` | Cria ou atualiza as tabelas do banco |
| `npm start` | Inicia o servidor |
| `npm run dev` | Inicia e reinicia sozinho quando um arquivo do servidor muda |
| `npm test` | Monta o front-end e roda os testes da API (banco temporário) |
| `npm run seed` | Cria a organização `demo` com dados fictícios (`-- --reset` para recriar) |
| `npm run create-owner -- --slug … --org "…" --nome "…" --email …` | Cria uma organização e a pessoa gestora |
| `npm run reset-password -- --email …` | Gera senha provisória para uma conta |
| `npm run backup` | Cópia de segurança do banco, dos arquivos e dos modelos |
| `npm run import-claude -- --file … --tenant …` | Importa dados exportados da versão do Claude ([guia](docs/MIGRACAO-DE-DADOS.md)) |

## Variáveis de ambiente

Todas ficam no arquivo `.env` (modelo em `.env.example`). Nenhuma senha ou chave vem preenchida.

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `BASE_URL` | `http://localhost:3000` | Endereço público, sem barra no final. Usado no link do Portal da Família, no cookie seguro e no retorno do Google |
| `DATA_DIR` | `./data` | Pasta do banco SQLite, dos arquivos enviados e dos modelos Word. **Faça backup dela** |
| `NODE_ENV` | `development` | Use `production` no servidor |
| `ALLOW_SIGNUP` | `false` | `true` libera o cadastro aberto em `/signup` (cada cadastro cria uma organização nova) |
| `TRUST_PROXY` | `false` | `true` quando houver proxy reverso (Caddy, Nginx, Render, Railway…) |
| `DEFAULT_TIMEZONE` | `America/Sao_Paulo` | Fuso dos eventos do Google Agenda |
| `MAX_UPLOAD_MB` | `25` | Tamanho máximo de cada arquivo enviado |
| `SESSION_DAYS` | `30` | Validade da sessão de login |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | vazio | Credenciais OAuth do Google (opcional) |
| `TOKEN_ENC_KEY` | vazio | Chave (32 bytes em base64) que criptografa os tokens do Google no banco. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

Sem as três variáveis do Google o sistema funciona normalmente; só o botão “Criar sala no Google Meet” avisa que a integração não foi configurada (o link pode ser colado à mão).

## Estrutura de pastas

```
client/
  src/gestao.src.html    sistema de gestão (todas as telas, estilos e lógica)
  src/planner.src.html   módulo Planner de projetos
  src/lousa.src.html     módulo Lousa Viva
  build.js               junta os três em public/app.html (isola o CSS de cada módulo)
public/
  static/claude-compat.js  camada que substitui o ambiente do Claude (fala com a API)
  static/conta.js, pages.css, favicon.svg
server/
  index.js     servidor HTTP: páginas, API REST, arquivos
  realtime.js  WebSocket: assinaturas de dados e sala da Lousa
  store.js     documentos JSON por organização
  rules.js     regras de acesso (quem lê e quem grava cada coleção)
  auth.js      contas, senhas (bcrypt), sessões, organizações e papéis
  org.js       criação de organização
  google.js    Google Agenda + Meet (OAuth e criação de evento)
  pages.js     páginas de login, cadastro e conta
  db.js, config.js
  templates/modelo-contrato-generico.docx   modelo Word padrão
migrations/    SQL do banco
scripts/       migrate, seed, create-owner, reset-password, import-claude
seed/demo.json dados fictícios da demonstração
test/          testes da API (npm test) e teste de navegador opcional (test/e2e)
docs/          documentação
```

## Verificado

O pacote foi testado do zero numa pasta limpa (`npm ci`, `build`, `migrate`, `seed`, `start`) com um navegador automatizado: login e senha errada, painel com os dados, leads em tempo real entre duas pessoas, contrato Word com os dados da organização, envio e download de anexo, Planner, Lousa Viva, Portal da Família no celular sem conta, aluno vendo só a Lousa, bloqueios de acesso, inclusão de pessoa com senha provisória e troca obrigatória, e criação de sala do Meet contra um Google simulado. Os testes automáticos da API estão em `npm test`.

O que **não** foi testado de verdade: o login com uma conta Google real (depende das suas credenciais OAuth; o fluxo foi testado com um servidor que imita o Google), a construção da imagem Docker (o ambiente de teste não tinha Docker ativo; o `Dockerfile` segue os mesmos comandos verificados acima) e a publicação num provedor específico.

## Limitações conhecidas e próximos passos para vender como SaaS

- **Recuperar senha por e-mail** não existe ainda: a gestão gera senha provisória na página Conta e equipe, e a pessoa gestora pode usar `npm run reset-password`. Para o produto comercial, ligue um serviço de e-mail (Resend, SendGrid, Amazon SES) e crie o fluxo “esqueci a senha”.
- **Cobrança da assinatura** (planos, cartão, Pix recorrente) não faz parte deste pacote. Sugestão: Stripe, Asaas, Iugu ou Pagar.me, com um campo de plano/status na tabela `tenants`.
- **Termos de uso e LGPD**: o sistema guarda dados pessoais de crianças e responsáveis. Antes de vender, prepare termos, política de privacidade, contrato de operador de dados com cada escola e um processo de exclusão e exportação de dados.
- **Escala**: SQLite num servidor atende bem dezenas de organizações. Para muitas organizações ou mais de um servidor, troque por PostgreSQL e use um armazenamento de arquivos como S3 (ver [ARQUITETURA](docs/ARQUITETURA.md#banco-de-dados)).
- O modelo Word padrão traz as cláusulas do contrato usado no Instituto Vértice, com os dados da empresa trocados por campos. **Peça a revisão de um advogado** antes de oferecer o modelo a outras escolas.
