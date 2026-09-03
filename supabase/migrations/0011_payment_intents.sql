-- What a payer told us they were about to do, recorded before the money moves.
--
-- A private STRK20 transfer publishes nothing on the public chain, so Nomos
-- cannot watch for "did anyone pay this link?" — there is no such event. At
-- the moment of payment exactly one party holds the transaction hash: the
-- payer's browser. That made the browser load-bearing settlement
-- infrastructure, and browsers hang, close, and lose networks. Three real
-- payments were lost that way.
--
-- An intent is written before the wallet is invoked. Afterwards Nomos can see
-- an unclaimed note arrive (its viewing key finds it) but not who it was for —
-- the note carries an amount, not a link. The intent supplies exactly that
-- missing half, so an orphaned payment can be attributed without the browser
-- and without a human.
create table if not exists payment_intents (
  id uuid primary key default gen_random_uuid(),
  link_id text,
  merchant_address text not null,
  network_index integer not null,
  flow text not null check (flow in ('A', 'B')),
  amount_wei numeric(78, 0) not null,
  token text not null,
  -- open: money may still arrive. matched: a deposit was attributed to it.
  -- abandoned: swept after long enough that a match would be a guess.
  status text not null default 'open' check (status in ('open', 'matched', 'abandoned')),
  deposit_id uuid references deposits(id),
  created_at timestamptz not null default now(),
  matched_at timestamptz
);

-- Attribution looks up open intents by what a note can be compared against:
-- network, token and amount.
create index if not exists payment_intents_open_idx
  on payment_intents (network_index, token, amount_wei)
  where status = 'open';

create index if not exists payment_intents_merchant_idx
  on payment_intents (merchant_address, network_index, created_at desc);

comment on table payment_intents is
  'A payment attempt recorded before the wallet is invoked, so an unattributed on-chain arrival can be matched back to its link without relying on the payer''s browser.';
