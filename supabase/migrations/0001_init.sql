-- Nomos ledger schema. numeric(78,0) throughout for wei-precision amounts —
-- never float. Run this against a fresh Supabase project once one exists;
-- see docs/IMPLEMENTATION.md Phase 1 for the Store interface this backs.

create extension if not exists pgcrypto;

create table merchants (
  address text primary key,
  public_key text not null default '',
  secret_key_hash text not null default '',
  webhook_url text,
  created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null references merchants(address),
  destination text not null,
  amount_wei numeric(78,0) not null,
  mode text not null check (mode in ('withdraw','transfer')),
  status text not null default 'pending' check (status in ('pending','broadcasting','confirmed','failed')),
  tx_hash text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table deposits (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null references merchants(address),
  flow text not null check (flow in ('A','B')),
  tx_hash text not null unique,
  amount_wei numeric(78,0) not null,
  token text not null default 'STRK',
  note text,
  ref text,
  status text not null default 'pending_verify'
    check (status in ('pending_verify','verified','pending_shield','shielded','shield_failed','rejected')),
  shield_tx_hash text,
  recorded_at timestamptz not null default now()
);

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null references merchants(address),
  direction text not null check (direction in ('credit','debit')),
  amount_wei numeric(78,0) not null,
  kind text not null check (kind in ('flow_a_deposit','flow_b_deposit','payout')),
  deposit_id uuid references deposits(id),
  payout_id uuid references payouts(id),
  running_balance_wei numeric(78,0) not null,
  created_at timestamptz not null default now()
);

create index deposits_merchant_address_idx on deposits(merchant_address);
create index deposits_status_idx on deposits(status);
create index ledger_entries_merchant_address_idx on ledger_entries(merchant_address, created_at desc);
create index payouts_merchant_address_idx on payouts(merchant_address);
