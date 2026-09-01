-- Make a debit atomic, so two payouts can't spend the same balance.
--
-- debitLedger used to read the running balance, compare it in application
-- code, then insert a debit row. Two concurrent payouts for one merchant both
-- read the same balance, both passed the check, and both inserted — letting a
-- merchant withdraw more than they hold. The window is small but the failure
-- is real money out of shared custody.
--
-- Doing it inside a function lets Postgres arbitrate: the advisory lock
-- serialises debits per (merchant, token, network), so the second caller
-- reads a balance that already reflects the first.

create or replace function debit_ledger(
  p_merchant_address text,
  p_network_index integer,
  p_token text,
  p_amount_wei numeric,
  p_kind text,
  p_payout_id uuid default null
)
returns ledger_entries
language plpgsql
as $$
declare
  v_balance numeric(78,0);
  v_row ledger_entries;
begin
  if p_amount_wei <= 0 then
    raise exception 'debit amount must be positive' using errcode = '22023';
  end if;

  -- Held until the transaction commits. Scoped per merchant+token+network so
  -- unrelated payouts never queue behind each other.
  perform pg_advisory_xact_lock(hashtextextended(
    lower(p_merchant_address) || ':' || p_token || ':' || p_network_index, 0
  ));

  select coalesce(running_balance_wei, 0) into v_balance
  from ledger_entries
  where merchant_address = lower(p_merchant_address)
    and token = p_token
    and network_index = p_network_index
  order by created_at desc
  limit 1;

  v_balance := coalesce(v_balance, 0);

  if v_balance < p_amount_wei then
    -- Carries the numbers so the caller can build the same error it always did.
    raise exception 'insufficient balance: have %, need %', v_balance, p_amount_wei
      using errcode = 'P0001';
  end if;

  insert into ledger_entries (
    merchant_address, network_index, direction, amount_wei, token, kind,
    payout_id, running_balance_wei
  ) values (
    lower(p_merchant_address), p_network_index, 'debit', p_amount_wei, p_token, p_kind,
    p_payout_id, v_balance - p_amount_wei
  )
  returning * into v_row;

  return v_row;
end;
$$;
