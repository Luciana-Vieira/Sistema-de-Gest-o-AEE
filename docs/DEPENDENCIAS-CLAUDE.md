# O que dependia do Claude e o que entrou no lugar

A versão original roda como artefato no claude.ai e usa recursos do ambiente do Claude. Esta tabela mostra cada um deles e a substituição feita neste pacote. Nada deste pacote chama serviços do Claude ou da Anthropic.

| Recurso no Claude | Para que o sistema usava | Substituição neste pacote | Onde está |
|---|---|---|---|
| Hospedagem do artefato (link `claude.ai/artifact/…`) | Abrir o sistema e o Portal da Família | Servidor Node próprio; endereços `/w/<org>/` e `/w/<org>/familia` | `server/index.js` |
| `window.claude.use("db")` — banco compartilhado do artefato | Todos os registros (alunos, aulas, finanças…), com `onSnapshot` em tempo real | Tabela `docs` no SQLite + API REST + WebSocket, com a mesma interface (`collection`, `doc`, `get`, `set`, `update`, `delete`, `onSnapshot`, `docChanges`) | `server/store.js`, `server/realtime.js`, `public/static/claude-compat.js` |
| Regras de acesso do banco (níveis admin/interact/view) | Equipe vê tudo; alunos só a Lousa; famílias só o portal | Mesmas regras em `server/rules.js`, aplicadas em toda leitura e gravação | `server/rules.js` |
| `use("user")` — conta do claude.ai e botão **Compartilhar** (Editor, Colaborador, Leitor) | Saber quem está logado, quem é dono, nomes e avatares | Contas próprias (e-mail e senha), papéis **Gestão / Equipe / Aluno(a) / Família**, página **Conta e equipe** | `server/auth.js`, `server/pages.js`, `public/static/conta.js` |
| Famílias precisavam de conta no claude.ai (Leitor) | Entrar no Portal da Família | Portal **sem conta**: só o link e o código de acesso pessoal | rota `/w/<org>/familia`, regra `publicGet` em `portal/` |
| `use("room")` — sala em tempo real | Traço ao vivo, laser, “chamar a turma”, presença na Lousa | WebSocket próprio com `emit`, `on`, `presence`, `onPeers`, `onConnection` | `server/realtime.js` |
| `use("assets")` — arquivos do artefato (`/_blob/<id>`) | Anexos do aluno, imagens da Lousa, anexos do Planner | Upload para `DATA_DIR/assets`, mesmo caminho `/_blob/<id>`, acesso só para membros | `server/index.js` |
| `use("downloads")` — salvar arquivo | Contrato, PDI e relatório Word, CSV do financeiro, PNG da Lousa | Download direto pelo navegador | `public/static/claude-compat.js` |
| `use("mcp")` + conector **Google Calendar** do Claude | Criar evento com sala do Meet nas aulas e reuniões on-line | Integração OAuth própria com a API do Google Calendar (cada pessoa conecta a sua conta em Conta e equipe) | `server/google.js` |
| Arquivo `modelo-contrato.txt` publicado junto com o artefato | Modelo Word do contrato, PDI e relatório | Modelo padrão em `server/templates/` ou modelo próprio enviado pela gestão (por organização) | rota `/w/<org>/modelo-contrato.txt` |
| Marca fixa “Instituto Vértice”, dados e Pix da empresa no código | Barra lateral, mensagens, documentos | Marca e dados de cada organização (Conta e equipe › Dados da organização) e ajustes iniciais neutros | `VX_CONFIG.org`, campos `{{ORG_*}}` |
| JSZip carregado do cdnjs | Gerar os arquivos Word | Servido pelo próprio servidor a partir do pacote npm `jszip` | `/static/jszip.min.js` |

## Diferenças de comportamento que vale conhecer

- **Papéis.** No Claude, quem recebia acesso de *Editor* virava equipe, *Colaborador* virava aluno e *Leitor* virava família. Aqui esses papéis são escolhidos na página Conta e equipe.
- **Famílias.** Não precisam mais criar conta. As instruções que o sistema monta para enviar por WhatsApp já trazem só o link e o código.
- **Google Meet.** No Claude, o conector usava a conta Google ligada ao claude.ai. Aqui cada pessoa da equipe conecta a própria conta Google uma vez. É preciso criar as credenciais OAuth (ver DEPLOY).
- **Erros de permissão** voltam com o código `permission_denied` (no Claude vinham como `invalid_argument`); as telas foram ajustadas para tratar os dois.
- **Arquivos já enviados no Claude** (anexos, imagens da Lousa) precisam ser exportados e importados junto com os dados; o importador mantém os mesmos ids, então as referências continuam funcionando.

## Como trocar a camada de compatibilidade no futuro

A camada `claude-compat.js` existe para manter as telas atuais funcionando sem reescrita. Se a equipe de desenvolvimento quiser um front-end novo:
1. Use diretamente a API REST e o WebSocket descritos em [ARQUITETURA.md](ARQUITETURA.md#api).
2. Reescreva uma tela de cada vez; as duas versões podem conviver porque usam o mesmo banco.
3. Quando nenhuma tela usar mais `window.claude`, remova `claude-compat.js` e a etapa `client/build.js`.
