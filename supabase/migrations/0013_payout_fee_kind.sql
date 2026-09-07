-- ledger_entries.kind has allowed three values since 0001, but the code has
-- written four since payouts started charging a fee: a payout is debited as
-- two entries, `payout` and `payout_fee`, so a merchant's history shows what
-- left and what it cost separately rather than as one number to reconcile.
--
-- The second insert violated the constraint, and because it ran after the
-- on-chain transfer had already succeeded, the payout was left marked failed
-- with its transaction hash discarded — funds gone, no record of where.
--
-- Written to be safe to re-run, and to name the constraint explicitly rather
-- than relying on whatever Postgres generated.
alter table ledger_entries drop constraint if exists ledger_entries_kind_check;

alter table ledger_entries
  add constraint ledger_entries_kind_check
  check (kind in ('flow_a_deposit', 'flow_b_deposit', 'payout', 'payout_fee'));
