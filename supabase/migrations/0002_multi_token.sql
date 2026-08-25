-- Adds multi-token settlement (STRK + USDC). deposits already carried a
-- token column from day one; ledger_entries and payouts didn't, because
-- the ledger was originally a single aggregate balance per merchant. A
-- balance is now scoped to (merchant, token) — STRK and USDC are different
-- assets with different decimals, so they can never be summed together.
-- default 'STRK' backfills existing rows without a manual data migration.

alter table ledger_entries add column token text not null default 'STRK';
alter table payouts add column token text not null default 'STRK';

-- getLedgerBalance's hot path: latest running_balance_wei for one
-- (merchant, token) pair.
create index ledger_entries_merchant_token_idx on ledger_entries(merchant_address, token, created_at desc);
