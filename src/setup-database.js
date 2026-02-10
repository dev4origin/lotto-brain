/**
 * Database Setup Script
 * 
 * This script outputs the SQL commands needed to create the database schema.
 * Run these commands in your Supabase SQL Editor.
 */

const SQL_SCHEMA = `
-- =====================================================
-- LOTTO PATTERNS DATABASE SCHEMA
-- =====================================================

-- Table: draw_types (Types de tirages)
CREATE TABLE IF NOT EXISTS draw_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(50), -- 'standard', 'night', 'digital', 'special'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: draws (Résultats des tirages)
CREATE TABLE IF NOT EXISTS draws (
  id SERIAL PRIMARY KEY,
  draw_type_id INTEGER REFERENCES draw_types(id),
  draw_date DATE NOT NULL,
  draw_time TIME,
  -- Numéros gagnants (5 numéros)
  winning_number_1 INTEGER NOT NULL CHECK (winning_number_1 BETWEEN 1 AND 90),
  winning_number_2 INTEGER NOT NULL CHECK (winning_number_2 BETWEEN 1 AND 90),
  winning_number_3 INTEGER NOT NULL CHECK (winning_number_3 BETWEEN 1 AND 90),
  winning_number_4 INTEGER NOT NULL CHECK (winning_number_4 BETWEEN 1 AND 90),
  winning_number_5 INTEGER NOT NULL CHECK (winning_number_5 BETWEEN 1 AND 90),
  -- Numéros machine (5 numéros)
  machine_number_1 INTEGER CHECK (machine_number_1 BETWEEN 1 AND 90),
  machine_number_2 INTEGER CHECK (machine_number_2 BETWEEN 1 AND 90),
  machine_number_3 INTEGER CHECK (machine_number_3 BETWEEN 1 AND 90),
  machine_number_4 INTEGER CHECK (machine_number_4 BETWEEN 1 AND 90),
  machine_number_5 INTEGER CHECK (machine_number_5 BETWEEN 1 AND 90),
  -- Métadonnées
  raw_winning_numbers VARCHAR(50), -- Original string format
  raw_machine_numbers VARCHAR(50), -- Original string format
  month_year VARCHAR(20), -- 'février 2026', etc.
  day_of_week INTEGER, -- 0=Sunday, 1=Monday, etc.
  week_of_year INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Contraintes
  UNIQUE(draw_type_id, draw_date, raw_winning_numbers)
);

-- Table: number_frequency (Fréquence des numéros par type de tirage)
CREATE TABLE IF NOT EXISTS number_frequency (
  id SERIAL PRIMARY KEY,
  draw_type_id INTEGER REFERENCES draw_types(id),
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 90),
  total_count INTEGER DEFAULT 0,
  position_1_count INTEGER DEFAULT 0,
  position_2_count INTEGER DEFAULT 0,
  position_3_count INTEGER DEFAULT 0,
  position_4_count INTEGER DEFAULT 0,
  position_5_count INTEGER DEFAULT 0,
  last_seen DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draw_type_id, number)
);

-- Table: number_pairs (Paires de numéros fréquentes)
CREATE TABLE IF NOT EXISTS number_pairs (
  id SERIAL PRIMARY KEY,
  draw_type_id INTEGER REFERENCES draw_types(id),
  number_1 INTEGER NOT NULL CHECK (number_1 BETWEEN 1 AND 90),
  number_2 INTEGER NOT NULL CHECK (number_2 BETWEEN 1 AND 90),
  occurrence_count INTEGER DEFAULT 0,
  last_seen DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draw_type_id, number_1, number_2),
  CHECK (number_1 < number_2)
);

-- Table: patterns (Patterns identifiés)
CREATE TABLE IF NOT EXISTS patterns (
  id SERIAL PRIMARY KEY,
  pattern_type VARCHAR(50) NOT NULL,
  -- Types: 'hot_number', 'cold_number', 'overdue', 'consecutive_pair', 
  --        'sum_range', 'odd_even_ratio', 'high_low_ratio', 'repeated_sequence'
  draw_type_id INTEGER REFERENCES draw_types(id),
  description TEXT,
  numbers JSONB, -- Les numéros impliqués
  strength DECIMAL(5,2), -- Force du pattern (0-100)
  last_occurrence DATE,
  occurrence_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: predictions (Prédictions basées sur les patterns)
CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  draw_type_id INTEGER REFERENCES draw_types(id),
  prediction_date DATE NOT NULL,
  predicted_numbers JSONB NOT NULL,
  confidence_score DECIMAL(5,2),
  pattern_ids JSONB, -- IDs des patterns utilisés
  was_correct BOOLEAN,
  actual_numbers JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_draws_date ON draws(draw_date);
CREATE INDEX IF NOT EXISTS idx_draws_type ON draws(draw_type_id);
CREATE INDEX IF NOT EXISTS idx_draws_month ON draws(month_year);
CREATE INDEX IF NOT EXISTS idx_draws_day_of_week ON draws(day_of_week);
CREATE INDEX IF NOT EXISTS idx_frequency_number ON number_frequency(number);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_strength ON patterns(strength DESC);

-- =====================================================
-- VIEWS
-- =====================================================

-- Vue: Statistiques globales par type de tirage
CREATE OR REPLACE VIEW v_draw_type_stats AS
SELECT 
  dt.id,
  dt.name,
  dt.category,
  COUNT(d.id) as total_draws,
  MIN(d.draw_date) as first_draw_date,
  MAX(d.draw_date) as last_draw_date,
  COUNT(DISTINCT d.month_year) as months_active
FROM draw_types dt
LEFT JOIN draws d ON dt.id = d.draw_type_id
GROUP BY dt.id, dt.name, dt.category;

-- Vue: Numéros les plus fréquents (Hot Numbers)
CREATE OR REPLACE VIEW v_hot_numbers AS
SELECT 
  dt.name as draw_type,
  nf.number,
  nf.total_count,
  nf.last_seen,
  ROUND((nf.total_count::DECIMAL / NULLIF(
    (SELECT COUNT(*) FROM draws WHERE draw_type_id = nf.draw_type_id), 0
  )) * 100, 2) as frequency_percentage
FROM number_frequency nf
JOIN draw_types dt ON nf.draw_type_id = dt.id
ORDER BY nf.total_count DESC;

-- Vue: Numéros en retard (Overdue Numbers)
CREATE OR REPLACE VIEW v_overdue_numbers AS
SELECT 
  dt.name as draw_type,
  nf.number,
  nf.total_count,
  nf.last_seen,
  CURRENT_DATE - nf.last_seen as days_since_last_seen
FROM number_frequency nf
JOIN draw_types dt ON nf.draw_type_id = dt.id
WHERE nf.total_count > 0
ORDER BY days_since_last_seen DESC;

-- Vue: Résumé des patterns actifs
CREATE OR REPLACE VIEW v_active_patterns AS
SELECT 
  p.id,
  dt.name as draw_type,
  p.pattern_type,
  p.description,
  p.numbers,
  p.strength,
  p.occurrence_count,
  p.last_occurrence
FROM patterns p
LEFT JOIN draw_types dt ON p.draw_type_id = dt.id
WHERE p.strength >= 50
ORDER BY p.strength DESC;

-- =====================================================
-- INSERT DEFAULT DRAW TYPES
-- =====================================================

INSERT INTO draw_types (name, category) VALUES
  ('Reveil', 'standard'),
  ('Etoile', 'standard'),
  ('Akwaba', 'standard'),
  ('Monday Special', 'special'),
  ('La Matinale', 'standard'),
  ('Emergence', 'standard'),
  ('Sika', 'standard'),
  ('Lucky Tuesday', 'special'),
  ('Premiere Heure', 'standard'),
  ('Fortune', 'standard'),
  ('Baraka', 'standard'),
  ('Midweek', 'special'),
  ('Kado', 'standard'),
  ('Privilege', 'standard'),
  ('Monni', 'standard'),
  ('Fortune Thursday', 'special'),
  ('Cash', 'standard'),
  ('Solution', 'standard'),
  ('Wari', 'standard'),
  ('Friday Bonanza', 'special'),
  ('Soutra', 'standard'),
  ('Diamant', 'standard'),
  ('Moaye', 'standard'),
  ('National', 'special'),
  ('Benediction', 'standard'),
  ('Prestige', 'standard'),
  ('Awale', 'standard'),
  ('Espoir', 'standard'),
  ('Day Off', 'special'),
  ('Digital 21h', 'digital'),
  ('Digital Reveil 7h', 'digital'),
  ('Digital 23h', 'digital'),
  ('Special Weekend 1h', 'night'),
  ('Special Weekend 3h', 'night'),
  ('Digital Reveil 8h', 'digital'),
  ('Digital 22h', 'digital')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Fonction pour mettre à jour les fréquences après insertion d'un nouveau tirage
CREATE OR REPLACE FUNCTION update_number_frequency()
RETURNS TRIGGER AS $$
BEGIN
  -- Update frequency for each winning number
  INSERT INTO number_frequency (draw_type_id, number, total_count, position_1_count, last_seen)
  VALUES (NEW.draw_type_id, NEW.winning_number_1, 1, 1, NEW.draw_date)
  ON CONFLICT (draw_type_id, number) 
  DO UPDATE SET 
    total_count = number_frequency.total_count + 1,
    position_1_count = number_frequency.position_1_count + 1,
    last_seen = GREATEST(number_frequency.last_seen, NEW.draw_date),
    updated_at = NOW();

  INSERT INTO number_frequency (draw_type_id, number, total_count, position_2_count, last_seen)
  VALUES (NEW.draw_type_id, NEW.winning_number_2, 1, 1, NEW.draw_date)
  ON CONFLICT (draw_type_id, number) 
  DO UPDATE SET 
    total_count = number_frequency.total_count + 1,
    position_2_count = number_frequency.position_2_count + 1,
    last_seen = GREATEST(number_frequency.last_seen, NEW.draw_date),
    updated_at = NOW();

  INSERT INTO number_frequency (draw_type_id, number, total_count, position_3_count, last_seen)
  VALUES (NEW.draw_type_id, NEW.winning_number_3, 1, 1, NEW.draw_date)
  ON CONFLICT (draw_type_id, number) 
  DO UPDATE SET 
    total_count = number_frequency.total_count + 1,
    position_3_count = number_frequency.position_3_count + 1,
    last_seen = GREATEST(number_frequency.last_seen, NEW.draw_date),
    updated_at = NOW();

  INSERT INTO number_frequency (draw_type_id, number, total_count, position_4_count, last_seen)
  VALUES (NEW.draw_type_id, NEW.winning_number_4, 1, 1, NEW.draw_date)
  ON CONFLICT (draw_type_id, number) 
  DO UPDATE SET 
    total_count = number_frequency.total_count + 1,
    position_4_count = number_frequency.position_4_count + 1,
    last_seen = GREATEST(number_frequency.last_seen, NEW.draw_date),
    updated_at = NOW();

  INSERT INTO number_frequency (draw_type_id, number, total_count, position_5_count, last_seen)
  VALUES (NEW.draw_type_id, NEW.winning_number_5, 1, 1, NEW.draw_date)
  ON CONFLICT (draw_type_id, number) 
  DO UPDATE SET 
    total_count = number_frequency.total_count + 1,
    position_5_count = number_frequency.position_5_count + 1,
    last_seen = GREATEST(number_frequency.last_seen, NEW.draw_date),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger
DROP TRIGGER IF EXISTS trg_update_frequency ON draws;
CREATE TRIGGER trg_update_frequency
AFTER INSERT ON draws
FOR EACH ROW
EXECUTE FUNCTION update_number_frequency();
`;

console.log('=' .repeat(60));
console.log('🎰 LOTTO PATTERNS - DATABASE SETUP');
console.log('=' .repeat(60));
console.log('');
console.log('📋 Instructions:');
console.log('1. Allez sur votre dashboard Supabase');
console.log('2. Cliquez sur "SQL Editor" dans le menu de gauche');
console.log('3. Copiez et exécutez le SQL ci-dessous');
console.log('');
console.log('=' .repeat(60));
console.log('SQL SCHEMA:');
console.log('=' .repeat(60));
console.log(SQL_SCHEMA);
console.log('');
console.log('=' .repeat(60));
console.log('✅ Après avoir exécuté ce SQL, lancez: npm run scrape');
console.log('=' .repeat(60));
