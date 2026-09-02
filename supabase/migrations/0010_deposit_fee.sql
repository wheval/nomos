-- Nomos's flat fee, recorded per deposit.
--
-- Stored rather than derived so a later change to the fee schedule never
-- rewrites what a merchant was actually charged. amount_wei stays gross —
-- the payment as it happened on-chain — and the ledger is credited
-- amount_wei - fee_wei.
--
-- Existing rows default to 0: they settled before fees existed and were
-- credited in full, so 0 is the honest record, not a placeholder.
alter table deposits add column if not exists fee_wei numeric(78, 0) not null default 0;

comment on column deposits.fee_wei is
  'Nomos fee for this payment, in the token''s smallest unit. Gross is amount_wei; the merchant was credited amount_wei - fee_wei.';
