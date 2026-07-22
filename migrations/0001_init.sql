-- User/role/permission store for storage:{kind:'r2'} (plan/user-managent.md).
-- Apply with `bunx wrangler d1 migrations apply drystack-db --local` (dev) /
-- `--remote` (production, after `wrangler d1 create` has a real database_id
-- in wrangler.jsonc).

CREATE TABLE user (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  password          TEXT,
  avatar            TEXT,
  phone_number      TEXT,
  address           TEXT,
  email_verify_at   TEXT,
  invite_token      TEXT,
  invite_token_exp  TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX user_invite_token_idx ON user (invite_token)
  WHERE invite_token IS NOT NULL;

CREATE TABLE role (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_builtin  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_role (
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_role_role_id_idx ON user_role (role_id);

-- SuperAdmin exists as a normal role row from the start, but its membership
-- is only ever set once - by whoever completes /register-first against an
-- empty `user` table (see api-r2.ts's authRoutes `setup` branch). No UI path
-- ever assigns/unassigns it afterwards (see plan/user-managent.md mục 3/6).
INSERT INTO role (name, permissions, is_builtin) VALUES ('SuperAdmin', '[]', 1);
INSERT INTO role (name, permissions, is_builtin) VALUES ('Admin', '[]', 1);
INSERT INTO role (name, permissions, is_builtin) VALUES ('Editor', '[]', 1);
