# Trazer os dados da versão do Claude

Os dados do Instituto Vértice (alunos, aulas, finanças, acervo, Planner, Lousa…) estão no banco do artefato no Claude. Este pacote **não inclui esses dados**: eles são pessoais e ficam fora do código. A migração tem três passos.

## 1. Exportar do Claude

Peça ao Claude, na conversa em que o sistema foi criado, para **exportar os dados do artefato Vértice Gestão para o formato do importador** (este documento descreve o formato). O resultado é:

- um arquivo `export.json`:
  ```json
  {
    "docs": {
      "alunos/abc123": { "nome": "…", "…": "…" },
      "aulas/x9y8":    { "alunoId": "abc123", "…": "…" },
      "lv_ink/<id-da-pessoa>/boards/<tela>/els/<elemento>": { "…": "…" }
    },
    "assets": [
      { "id": "<id do arquivo>", "contentType": "application/pdf", "filename": "laudo.pdf" }
    ]
  }
  ```
- uma pasta `arquivos/` com os anexos e imagens, cada arquivo com o nome igual ao `id`;
- a lista das pessoas que usavam o sistema no Claude, com o id de cada uma (aparece nos campos de autoria e nos caminhos da Lousa).

Trate esses arquivos como confidenciais: têm dados de alunos e famílias.

## 2. Preparar a organização no servidor novo

```bash
npm run create-owner -- --slug vertice --org "Instituto Vértice" --nome "Seu Nome" --email seu-email@exemplo.com
```

Entre no sistema, troque a senha e, em **Conta e equipe**:
- preencha os dados da organização (marca, razão social, CNPJ, endereço, WhatsApp, rodapé);
- envie o modelo Word do Instituto (o arquivo original do contrato) em **Modelo dos documentos Word**;
- inclua as outras pessoas da equipe e os alunos que usam a Lousa.

## 3. Importar

Simule primeiro:

```bash
npm run import-claude -- --file export.json --tenant vertice --assets-dir ./arquivos --dry-run
```

Depois importe de verdade, trocando o id de cada pessoa no Claude pela conta nova (pelo e-mail):

```bash
npm run import-claude -- --file export.json --tenant vertice --assets-dir ./arquivos \
  --map <seu-id-no-claude>=seu-email@exemplo.com \
  --map <id-de-outra-pessoa>=outra@exemplo.com
```

O `--map` troca o id antigo nos caminhos (tinta da Lousa) e nos campos (autor do histórico, responsáveis do Planner). Pessoas sem `--map` continuam aparecendo com o id antigo, sem nome.

## 4. Conferir

- Abra o sistema com a conta da gestão: o painel, os alunos, a agenda e o financeiro devem mostrar os mesmos números da versão do Claude.
- Ao abrir, o sistema republica o Portal da Família de cada família ativa (alguns segundos depois de carregar). Os **códigos de acesso continuam os mesmos**; envie às famílias o link novo (`https://<seu-dominio>/w/vertice/familia`), que aparece em Conta e equipe.
- Abra um anexo e uma tela da Lousa com imagem para conferir os arquivos.
- Gere um contrato de teste para conferir o modelo Word.

Quando estiver tudo certo, avise as famílias e a equipe sobre o endereço novo e deixe de usar a versão do Claude (para não haver dados nos dois lugares).
