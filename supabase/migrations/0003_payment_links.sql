-- Persisted Payment Links. Previously a "link" was just URL query params
-- with no server-side record - anyone could edit a copied link (amount,
-- recipient) before sharing it, since nothing validated the params against
-- an authoritative source. The checkout page now fetches this row by id
-- instead of trusting the URL directly.

create table payment_links (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null references merchants(address),
  amount_wei numeric(78,0), -- null = open amount, customer enters their own
  token text not null default 'STRK',
  note text,
  ref text not null,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create index payment_links_merchant_address_idx on payment_links(merchant_address, created_at desc);
