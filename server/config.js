'use strict';
// Configuração lida das variáveis de ambiente (veja .env.example).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Carrega um arquivo .env simples (CHAVE=valor), sem sobrescrever o que já veio do ambiente.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|sim)$/i.test(v));

const config = {
  root: ROOT,
  port: parseInt(env.PORT || '3000', 10),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
  dataDir: path.resolve(ROOT, env.DATA_DIR || './data'),
  production: env.NODE_ENV === 'production',
  allowSignup: bool(env.ALLOW_SIGNUP, false),
  timezone: env.DEFAULT_TIMEZONE || 'America/Sao_Paulo',
  maxUploadMb: parseInt(env.MAX_UPLOAD_MB || '25', 10),
  sessionDays: parseInt(env.SESSION_DAYS || '30', 10),
  trustProxy: bool(env.TRUST_PROXY, false),
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    // Endereços da API do Google. Só mude para testes automatizados.
    authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    apiBase: env.GOOGLE_API_BASE || 'https://www.googleapis.com',
    revokeUrl: env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
  },
  // Chave para criptografar os tokens do Google no banco (32 bytes em base64).
  tokenKey: env.TOKEN_ENC_KEY || '',
};
config.dbFile = path.join(config.dataDir, 'vertice.sqlite');
config.assetsDir = path.join(config.dataDir, 'assets');
config.templatesDir = path.join(config.dataDir, 'templates');
config.googleEnabled = !!(config.google.clientId && config.google.clientSecret && config.tokenKey);

for (const d of [config.dataDir, config.assetsDir, config.templatesDir]) fs.mkdirSync(d, { recursive: true });

module.exports = config;
