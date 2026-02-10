-- Table pour stocker la mémoire persistante de l'IA (Poids des stratégies, stats d'apprentissage)
create table if not exists ai_memory (
  id text primary key, -- ex: 'winning', 'machine'
  data jsonb not null,
  updated_at timestamptz default now()
);

-- Activation RLS (Sécurité) - Optionnel si en mode service_role mais recommandé
alter table ai_memory enable row level security;

-- Politique pour lecture publique (si besoin) ou authentifiée
create policy "Allow read access to authenticated users"
  on ai_memory for select
  to authenticated, anon
  using (true);

-- Politique pour écriture (service role bypassera RLS, mais pour client anonyme attention)
-- Ici on suppose que le backend utilise service_role ou que l'on autorise l'écriture
create policy "Allow all access to everyone (dev mode)"
  on ai_memory for all
  to anon, authenticated
  using (true)
  with check (true);
