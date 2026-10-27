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

-- Reglas por comercio: "OXXO" → Alimentación. id = clave normalizada del comercio (ver merchant_key).
create table if not exists public.merchant_rules (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) between 1 and 60),
  name       text        not null default '' check (char_length(name) <= 60),
  category   text        not null check (char_length(category) <= 40),
  deleted    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Campos para movimientos que llegan desde Apple Pay (Wallet) y para el método de pago.
alter table public.transactions add column if not exists source   text    check (source is null or char_length(source) <= 20);
alter table public.transactions add column if not exists merchant text    check (merchant is null or char_length(merchant) <= 60);
alter table public.transactions add column if not exists card     text    check (card is null or char_length(card) <= 40);
alter table public.transactions add column if not exists review   boolean not null default false; -- true = pendiente de revisar

-- Saldo inicial: lo que tenías al ajustar el saldo. Saldo actual = opening_balance + ingresos - gastos (en centavos).
alter table public.settings add column if not exists opening_balance bigint not null default 0;
alter table public.settings add column if not exists opening_date    date; -- día del último ajuste (null = nunca)

do $$
declare t text;
begin
  foreach t in array array['transactions', 'budgets', 'goals', 'recurring', 'settings', 'merchant_rules'] loop
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

-- ---------------------------------------------------------------------------
-- Registro automático desde Apple Pay (app Atajos del iPhone)
-- ---------------------------------------------------------------------------
-- Atajos no puede iniciar sesión, así que usa un token personal secreto:
--   * La app lo genera con create_ingest_token() (requiere sesión) y lo muestra una sola vez.
--   * Aquí solo se guarda su huella SHA-256: quien viera la tabla no podría usarlo.
--   * ingest_wallet() lo recibe, identifica al usuario y crea el gasto. Es lo único que puede llamar "anon".
--   * Regenerar el token invalida el anterior; revoke_ingest_token() lo desactiva.

create table if not exists public.ingest_tokens (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  token_hash bytea       not null unique,
  created_at timestamptz not null default now()
);
alter table public.ingest_tokens enable row level security; -- sin políticas: solo las funciones de abajo la tocan
revoke all on public.ingest_tokens from anon, authenticated;

-- Clave de comercio: minúsculas, sin acentos ni signos, sin números sueltos ("OXXO 1234 CDMX" → "oxxo cdmx").
-- Debe coincidir con merchantKey() de js/util.js.
create or replace function public.merchant_key(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(
    translate(lower(coalesce(p, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'),
    '[^a-z0-9]+', ' ', 'g'), '\y[0-9]+\y', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.create_ingest_token() returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  v_token := 'gw_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.ingest_tokens (user_id, token_hash, created_at)
    values (auth.uid(), sha256(convert_to(v_token, 'UTF8')), now())
    on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = excluded.created_at;
  return v_token;
end $$;

create or replace function public.revoke_ingest_token() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.ingest_tokens where user_id = auth.uid();
end $$;

-- Fecha de creación del token actual (null si no hay).
create or replace function public.ingest_token_info() returns timestamptz
language sql security definer stable set search_path = '' as $$
  select created_at from public.ingest_tokens where user_id = auth.uid()
$$;

create or replace function public.ingest_wallet(p_token text, p_amount text, p_merchant text default '', p_card text default '', p_date text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid; v_raw text; v_clean text; v_amount bigint; v_merchant text; v_card text; v_key text;
  v_cat text; v_review boolean; v_id text; v_date date; v_dup text;
begin
  select user_id into v_user from public.ingest_tokens where token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'));
  if v_user is null then raise exception 'invalid token' using errcode = '28000'; end if;

  -- Monto: acepta "$1,234.50", "1234.5", "45,50". Los reembolsos (negativos) se rechazan.
  v_raw := coalesce(p_amount, '');
  if v_raw ~ '^\s*[-−(]' then raise exception 'negative amounts are not supported' using errcode = '22023'; end if;
  v_clean := regexp_replace(v_raw, '[^0-9.,]', '', 'g');
  if v_clean ~ '^\d{1,3}(,\d{3})+(\.\d+)?$' then v_clean := replace(v_clean, ',', '');
  elsif v_clean ~ '^\d+,\d{1,2}$' then v_clean := replace(v_clean, ',', '.');
  end if;
  if v_clean !~ '^(\d+\.?\d*|\.\d+)$' then raise exception 'invalid amount' using errcode = '22023'; end if;
  v_amount := round(v_clean::numeric * 100)::bigint;
  if v_amount <= 0 or v_amount > 99999999999 then raise exception 'invalid amount' using errcode = '22023'; end if;

  v_merchant := left(btrim(coalesce(p_merchant, '')), 60);
  v_card := left(btrim(coalesce(p_card, '')), 40);
  v_key := public.merchant_key(v_merchant);
  -- Atajos manda la fecha local del teléfono; si falta, se usa la hora de Ciudad de México.
  v_date := (now() at time zone 'America/Mexico_City')::date;
  if p_date ~ '^\d{4}-\d{2}-\d{2}$' then
    begin v_date := p_date::date;
    exception when others then null; -- fecha imposible (p. ej. 2026-13-45): se queda la de hoy en lugar de perder el gasto
    end;
  end if;

  -- Evita duplicados si el atajo se dispara dos veces seguidas por el mismo cargo.
  select id into v_dup from public.transactions
    where user_id = v_user and source = 'wallet' and amount = v_amount and coalesce(merchant, '') = v_merchant
      and not deleted and created_at > now() - interval '45 seconds' limit 1;
  if v_dup is not null then return jsonb_build_object('id', v_dup, 'duplicate', true); end if;

  select category into v_cat from public.merchant_rules where user_id = v_user and id = v_key and not deleted;
  v_review := v_cat is null;
  v_cat := coalesce(v_cat, 'otros-gasto');

  v_id := 'w_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.transactions (user_id, id, type, category, amount, date, description, created, source, merchant, card, review)
    values (v_user, v_id, 'expense', v_cat, v_amount, v_date, coalesce(nullif(v_merchant, ''), 'Apple Pay'),
            (extract(epoch from clock_timestamp()) * 1000)::bigint, 'wallet', nullif(v_merchant, ''), nullif(v_card, ''), v_review);
  return jsonb_build_object('id', v_id, 'category', v_cat, 'review', v_review);
end $$;

revoke all on function public.create_ingest_token(), public.revoke_ingest_token(), public.ingest_token_info(),
  public.ingest_wallet(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_ingest_token(), public.revoke_ingest_token(), public.ingest_token_info() to authenticated;
grant execute on function public.ingest_wallet(text, text, text, text, text) to anon, authenticated;
