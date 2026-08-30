-- Make a shielded note settle exactly one deposit.
--
-- Flow A can't be verified from public calldata, so a private payment is
-- confirmed by finding a matching note in the operating wallet. That wallet is
-- shared custody for every merchant, so a note that stays claimable forever
-- lets the same incoming payment be credited over and over — to whoever asks.
-- This table is the record of which notes are already spent, and the unique
-- index is what makes claiming atomic under concurrency.

create table if not exists claimed_notes (
  note_id text not null,
  network_index integer not null,
  claimed_at timestamptz not null default now(),
  primary key (network_index, note_id)
);
