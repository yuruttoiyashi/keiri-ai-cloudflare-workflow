DROP TABLE IF EXISTS journal_entries;

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  account_title TEXT NOT NULL,
  tax_category TEXT NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 1,
  confidence INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  ai_comment TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT 'rules',
  model TEXT NOT NULL DEFAULT 'local-rule-engine',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_at ON journal_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_journal_entries_risk_score ON journal_entries(risk_score);
