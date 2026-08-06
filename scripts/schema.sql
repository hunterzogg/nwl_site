-- NWL Pick'em schema. Run once against the Vercel Postgres database
-- (Vercel dashboard -> project -> Storage -> your database -> Query console -> paste + run).

CREATE TABLE IF NOT EXISTS managers (
  name TEXT PRIMARY KEY,
  passcode_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  week INT NOT NULL,
  season INT NOT NULL DEFAULT 2026,
  type TEXT NOT NULL,              -- 'this_or_that' | 'over_under'
  prompt TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  points INT NOT NULL DEFAULT 1,
  lock_at TIMESTAMPTZ NOT NULL,
  correct_option TEXT,             -- null until graded; 'a' | 'b'
  published BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS picks (
  manager TEXT NOT NULL REFERENCES managers(name),
  question_id INT NOT NULL REFERENCES questions(id),
  choice TEXT NOT NULL,            -- 'a' | 'b'
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (manager, question_id)
);

CREATE INDEX IF NOT EXISTS idx_questions_week ON questions(week);
CREATE INDEX IF NOT EXISTS idx_picks_question ON picks(question_id);
