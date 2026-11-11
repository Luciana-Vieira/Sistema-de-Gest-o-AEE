# Funcionalidades

## Módulos

| Módulo | O que faz |
|---|---|
| **Painel** | Alertas do dia (cobranças atrasadas, devoluções do acervo, revisões de PDI, aniversários, avaliações pendentes, aulas e reuniões on-line sem link), aulas de hoje, indicadores de leads, alunos e finanças |
| **Leads** | Cadastro de interessados, origem, status do funil, interações (ligação, WhatsApp, reunião…), reuniões agendadas e conversão em aluno |
| **Alunos** | Cadastro completo do aluno e responsáveis, horários fixos, mensalidade, contrato Word numerado, aulas, evolução, boletim, PDI, acesso da família, financeiro, anexos (cada um pode ser liberado para download no Portal da Família) e histórico de alterações |
| **Agenda** | Semana com aulas e reuniões, aulas recorrentes pelos horários fixos, presencial/on-line, link de reunião (colado ou criado no Google Meet), registro da aula (disciplinas trabalhadas com os conteúdos de cada uma, participação, compreensão e autonomia de Baixa a Ótima, gerais ou por disciplina, conquistas, pontos que precisam de apoio, orientação para casa, observações internas e opção de deixar a aula fora do relatório da família), mensagens prontas de WhatsApp |
| **Desempenho do aluno** | Tela própria para registrar a avaliação de cada aula (acesso pela aula na Agenda ou pela ficha do aluno): disciplinas como etiquetas, conteúdos por disciplina, participação/compreensão/autonomia de Baixa a Ótima (clicar de novo deixa sem avaliação; opção de avaliar cada disciplina), conquistas, pontos para desenvolver, orientação para casa, observações internas e chave "Incluir no relatório da família". Ao lado, a evolução do aluno com abas por disciplina, um ponto por aula (ou por mês), a aula atual destacada e resumos de aulas registradas, conquistas recentes e última atualização |
| **Reuniões com lead** | Agendamento presencial ou on-line, sala do Meet, convite por e-mail, pauta e resumo registrado nas interações do lead |
| **Avaliações e evolução** | Painel de desempenho nas aulas com filtros de período e disciplina, contagem de aulas consideradas, gráfico clicável (mostra o registro do dia), visão por disciplina, conteúdos trabalhados, conquistas, apoios e orientações para casa; avaliações por indicadores (1 a 4), publicação para a família, relatório Word para a família |
| **Boletins** | Notas por atividade (tipo, data, valor, nota) com validação, média, pontos fortes, a desenvolver, consulta por aluno, disciplina e período, publicação no portal |
| **PDI** | Plano de Desenvolvimento Individual com objetivos, rascunho e versão final, versões congeladas, revisão programada, Word e publicação para a família |
| **Financeiro** | Receitas e despesas, mensalidades em lote, cobranças em atraso, **gerar cobrança** com mensagem, período, valor e Pix (com Pix copia e cola), exportação CSV |
| **Acervo** | Livros, jogos e materiais com registro automático, empréstimo para aluno ou pessoa avulsa, devolução em 7 dias, reempréstimo, alertas e histórico |
| **Portal da Família (equipe)** | Item do menu para a equipe: escolher o aluno num modal com busca, ver a evolução só com o que é compartilhável, definir o período, **salvar em PDF** (identificação, período, gráfico, visão por disciplina, conteúdos, conquistas, pontos a desenvolver, orientações e registros por data, sem campos internos) e **enviar para a família** (revisão do destinatário entre os responsáveis cadastrados, WhatsApp ou e-mail, mensagem editável, confirmação e registro de data, destinatário e profissional). Sem registros no período, não gera PDF nem envio |
| **Portal da Família** | Acesso por código, sem conta: avaliações e boletins publicados, PDI publicado, documentos liberados pela gestão para baixar, acompanhamento das aulas com o mesmo painel de evolução (só registros compartilhados, sem campos internos) e registros por data e disciplina, próximas aulas com link |
| **Planner** | Quadros de projetos com listas, sprints, cartões, responsáveis, prazos, checklists, comentários, anexos e exportação CSV |
| **Lousa Viva** | Quadro colaborativo em tempo real: caneta, marca-texto, formas, texto, notas, imagens, laser, seguir o professor, chamar a turma, permissões por tela, exportação PNG |
| **Ajustes** | Cursos, origens, categorias, equipe, campos obrigatórios, indicadores, disciplinas, assinatura, dados do contrato e da cobrança |
| **Conta e equipe** | Pessoas e papéis, senhas provisórias, dados e marca da organização, modelo Word, Google Agenda, link do portal, troca de senha |

## Papéis

| Papel | Pode |
|---|---|
| **Gestão** | Tudo, inclusive Conta e equipe, dados da organização, modelo Word, ajustes, publicação de avaliações e liberação do Portal da Família |
| **Equipe** | Leads, alunos, agenda, financeiro, avaliações, boletins, PDI, acervo, anexos, Planner e Lousa Viva |
| **Aluno(a)** | Somente a Lousa Viva, escrevendo nas telas liberadas para ele |
| **Família** (com conta) | Acompanhar a Lousa Viva. O Portal da Família não exige conta |

## Modelo Word (contrato, PDI e relatório)

O sistema preenche os campos entre chaves duplas do modelo. Para criar um modelo próprio, edite `server/templates/modelo-contrato-generico.docx` no Word (ou envie outro arquivo em Conta e equipe) mantendo os campos que quiser usar. O PDI e o relatório usam o cabeçalho, o rodapé e os estilos do mesmo arquivo (o corpo é gerado pelo sistema).

| Campo | Conteúdo |
|---|---|
| `{{ORG_NOME}}`, `{{ORG_SUBTITULO}}` | Nome e subtítulo da organização (também no cabeçalho e no rodapé) |
| `{{ORG_RAZAO}}`, `{{ORG_DOC}}`, `{{ORG_END}}`, `{{ORG_REP}}`, `{{ORG_CONTATO}}`, `{{ORG_EMAIL}}`, `{{ORG_WHATS}}`, `{{ORG_RODAPE}}` | Dados da organização (Conta e equipe) |
| `{{NUM}}` | Número do contrato (ex.: 001/2026) |
| `{{RESP_NOME}}`, `{{RESP_CPF}}`, `{{RESP_RG}}`, `{{RESP_PARENT}}`, `{{RESP_TEL}}`, `{{RESP_EMAIL}}`, `{{RESP_END}}` | Responsável financeiro |
| `{{ALU_NOME}}`, `{{ALU_NASC}}`, `{{ALU_ESCOLA}}`, `{{ALU_ANO}}` | Aluno |
| `{{CK_P1}}`…`{{CK_P8}}`, `{{PACOTE_OUTRO}}` | Pacote marcado (☒/☐) |
| `{{FOCO}}`, `{{CK_M1}}`…`{{CK_M3}}`, `{{FREQ}}`, `{{DUR}}`, `{{HORARIOS}}` | Disciplinas, modalidade, frequência, duração e horários |
| `{{INICIO}}`, `{{VIG}}`, `{{FIMVIG}}` | Início e vigência |
| `{{VALOR}}`, `{{VALOR_EXT}}`, `{{CK_TM1}}`, `{{CK_TM2}}`, `{{TAXA_MAT}}`, `{{CK_TD1}}`, `{{CK_TD2}}`, `{{TAXA_DESL}}` | Valores e taxas |
| `{{DIA}}`, `{{CK_F1}}`…`{{CK_F3}}`, `{{PIX}}` | Vencimento, forma de pagamento e chave Pix |
| `{{AVISO_H}}`, `{{REPO_D}}`, `{{CK_MAT1}}`, `{{CK_MAT2}}`, `{{CK_FER1}}`, `{{CK_FER2}}`, `{{REC_DIAS}}`, `{{REC_PER}}` | Regras de aviso, reposição, materiais, feriados e recesso (Ajustes › Contrato) |
| `{{LOCAL_DATA}}` | Cidade e data da assinatura |

O modelo padrão vem das cláusulas do contrato do Instituto Vértice, com os dados da empresa trocados pelos campos `{{ORG_*}}`. Revise com um advogado antes de oferecer a outras escolas.
