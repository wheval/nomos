-- Test (Sepolia) and live (Mainnet) data has shared rows since day one -
-- there was no network column anywhere. Once the mainnet operating wallet
-- goes live alongside continued Sepolia testing, that means test activity
-- and real money would land in the same ledger balance. Every real payment
-- gateway (Stripe, Paystack) keeps test and live completely separate -
-- separate API keys, separate everything. This backfills every existing
-- row as network_index=2 (Sepolia) since that's the only network that has
-- ever been used, and makes (merchant, network) the real identity going
-- forward instead of merchant alone.
--
-- network_index matches the frontend's own convention in src/utils/constants.ts
-- (myFrontendProviders): 0 = Mainnet ("live"), 2 = Sepolia ("test").

-- merchants: one row per (address, network_index) instead of one per address.
-- A merchant's test and live API keys/webhook are now entirely separate
-- credentials - a test secret key can never authenticate a live request.
alter table deposits drop constraint deposits_merchant_address_fkey;
alter table payouts drop constraint payouts_merchant_address_fkey;
alter table ledger_entries drop constraint ledger_entries_merchant_address_fkey;
alter table payment_links drop constraint payment_links_merchant_address_fkey;

alter table merchants add column network_index integer not null default 2;
alter table merchants drop constraint merchants_pkey;
alter table merchants add primary key (address, network_index);

alter table deposits add column network_index integer not null default 2;
alter table payouts add column network_index integer not null default 2;
alter table ledger_entries add column network_index integer not null default 2;
alter table payment_links add column network_index integer not null default 2;

alter table deposits add constraint deposits_merchant_fkey
  foreign key (merchant_address, network_index) references merchants(address, network_index);
alter table payouts add constraint payouts_merchant_fkey
  foreign key (merchant_address, network_index) references merchants(address, network_index);
alter table ledger_entries add constraint ledger_entries_merchant_fkey
  foreign key (merchant_address, network_index) references merchants(address, network_index);
alter table payment_links add constraint payment_links_merchant_fkey
  foreign key (merchant_address, network_index) references merchants(address, network_index);

-- Replace the old single-network indexes with network-aware ones.
drop index deposits_merchant_address_idx;
drop index ledger_entries_merchant_address_idx;
drop index ledger_entries_merchant_token_idx;
drop index payouts_merchant_address_idx;
drop index payment_links_merchant_address_idx;

create index deposits_merchant_network_idx on deposits(merchant_address, network_index);
create index ledger_entries_merchant_network_idx on ledger_entries(merchant_address, network_index, created_at desc);
create index ledger_entries_merchant_token_network_idx on ledger_entries(merchant_address, token, network_index, created_at desc);
create index payouts_merchant_network_idx on payouts(merchant_address, network_index);
create index payment_links_merchant_network_idx on payment_links(merchant_address, network_index, created_at desc);
