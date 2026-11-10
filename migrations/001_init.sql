-- Estrutura inicial do Vértice Gestão SaaS.
-- Cada escola/professor é um "tenant" (organização). Os dados do sistema ficam
-- na tabela docs, no mesmo formato de documentos usado pela versão do Claude:
-- caminho "colecao/id" (ou subcoleções "colecao/id/sub/id2") e um JSON.

CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  settings    TEXT NOT NULL DEFAULT '{}',   -- marca e dados da organização (JSON)
  created_at  TEXT NOT NULL
);

CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                  TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);

-- Papéis: gestor (dono da conta), equipe (professores), aluno (só Lousa Viva),
-- familia (acompanha a Lousa; o Portal da Família funciona só com o código).
CREATE TABLE memberships (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('gestor','equipe','aluno','familia')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE docs (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  parent      TEXT NOT NULL,     -- caminho da coleção (path sem o último segmento)
  id          TEXT NOT NULL,     -- último segmento
  data        TEXT NOT NULL,     -- JSON
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT,
  PRIMARY KEY (tenant_id, path)
);
CREATE INDEX docs_parent ON docs(tenant_id, parent);

CREATE TABLE assets (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploader_id   TEXT,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  filename      TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX assets_tenant ON assets(tenant_id);

-- Integração Google Agenda (um vínculo por pessoa em cada organização).
-- Os tokens ficam criptografados com TOKEN_ENC_KEY.
CREATE TABLE google_tokens (
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email   TEXT,
  refresh_enc    TEXT NOT NULL,
  access_enc     TEXT,
  expires_at     INTEGER,
  scope          TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE oauth_states (
  state       TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
