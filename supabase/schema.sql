-- Esquema de Gastos para Supabase (PostgreSQL 15+).
-- Ejecútalo completo en Supabase → SQL Editor. Es idempotente: puedes correrlo de nuevo sin perder datos.
--
-- Convenciones:
--   * Montos en centavos (bigint) para evitar errores de redondeo.
--   * Llave primaria (user_id, id): los ids los genera la app (UUID), así funciona sin conexión.
--   * Borrado lógico (deleted) para propagar eliminaciones entre dispositivos.
--   * updated_at lo fija el servidor; la app sincroniza pidiendo "lo que cambió desde X".

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table if not exists public.transactions (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id           text        not null check (char_length(id) <= 64),
  type         text        not null check (type in ('income', 'expense')),
  category     text        not null check (char_length(category) <= 40),
  amount       bigint      not null check (amount > 0),
  date         date        not null,
  description  text        not null default '' check (char_length(description) <= 120),
  recurring_id text        check (char_length(recurring_id) <= 64),
  created      bigint,     -- marca de tiempo del dispositivo (ms), para ordenar movimientos del mismo día
  deleted      boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

-- Presupuesto mensual por categoría (id = id de la categoría).
create table if not exists public.budgets (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) <= 40),
  amount     bigint      not null check (amount >= 0),
  deleted    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Metas de ahorro.
create table if not exists public.goals (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) <= 64),
  name       text        not null check (char_length(name) between 1 and 60),
  target     bigint      not null check (target > 0),
  saved      bigint      not null default 0 check (saved >= 0),
  deadline   date,
  color      text        not null default '#3B82F6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  deleted    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Pagos e ingresos recurrentes (renta, suscripciones, quincena, meses sin intereses...).
create table if not exists public.recurring (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null check (char_length(id) <= 64),
  name        text        not null check (char_length(name) between 1 and 60),
  type        text        not null check (type in ('income', 'expense')),
  category    text        not null check (char_length(category) <= 40),
  amount      bigint      not null check (amount > 0),
  day         smallint    not null check (day between 1 and 31),
  start_month date        not null,
  occurrences integer     check (occurrences is null or occurrences between 1 and 600),
  active      boolean     not null default true,
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- Preferencias (una fila con id = 'main').
create table if not exists public.settings (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) <= 40),
  currency   text        not null default 'MXN' check (currency in ('MXN', 'USD', 'EUR')),
  deleted    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['transactions', 'budgets', 'goals', 'recurring', 'settings'] loop
    -- Índice para la sincronización incremental.
    execute format('create index if not exists %I on public.%I (user_id, updated_at)', t || '_sync_idx', t);
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before insert or update on public.%I for each row execute function public.set_updated_at()', t);

    -- Row Level Security: cada usuario solo ve y modifica sus propias filas.
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create index if not exists transactions_month_idx on public.transactions (user_id, date) where not deleted;
