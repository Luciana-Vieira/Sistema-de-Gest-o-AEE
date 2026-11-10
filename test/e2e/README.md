# Teste de navegador (opcional)

Percorre o sistema como as pessoas usam: login, painel, leads em tempo real entre duas contas, contrato Word, anexo, Planner, Lousa, Portal da Família no celular, aluno só na Lousa, bloqueios de acesso, Conta e equipe e criação de sala do Meet contra um Google simulado. Salva capturas de tela.

Requisitos: Python 3.10+, `pip install playwright` e `python -m playwright install chromium`.

```bash
# terminal 1: Google simulado
node test/e2e/mockgoogle.js

# terminal 2: servidor apontando para o Google simulado, com dados de demonstração
rm -rf data-e2e
export DATA_DIR=./data-e2e PORT=3100 BASE_URL=http://127.0.0.1:3100 \
  GOOGLE_CLIENT_ID=teste GOOGLE_CLIENT_SECRET=teste \
  TOKEN_ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  GOOGLE_AUTH_URL=http://127.0.0.1:3299/auth GOOGLE_TOKEN_URL=http://127.0.0.1:3299/token \
  GOOGLE_API_BASE=http://127.0.0.1:3299 GOOGLE_REVOKE_URL=http://127.0.0.1:3299/revoke
npm run build && npm run seed > seed-e2e.txt && npm start

# terminal 3
python3 test/e2e/e2e.py http://127.0.0.1:3100 seed-e2e.txt e2e-capturas
```

No fim aparece `NO ERRORS` ou a lista de erros do navegador. Mensagens “403 (Forbidden)” para família e aluno são esperadas: o sistema testa o que cada papel pode ler ao abrir.
