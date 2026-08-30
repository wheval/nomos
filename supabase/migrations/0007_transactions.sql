-- Give every payment its own reference, and let a link be single-use.
--
-- Until now a deposit only carried the Payment Link's `ref`, which every
-- payment through that link shares — so two people paying the same link were
-- indistinguishable, and there was nothing for a merchant to verify against.
-- `reference` is unique per payment; `link_id` records which link produced it.

alter table deposits add column if not exists reference text;
alter table deposits add column if not exists link_id uuid references payment_links(id) on delete set null;

-- Backfill existing rows so the column can be made NOT NULL. The id is already
-- unique per deposit, so it is a safe source for a one-off reference.
update deposits set reference = 'nx_' || replace(id::text, '-', '') where reference is null;

alter table deposits alter column reference set not null;

create unique index if not exists deposits_reference_key on deposits (reference);
create index if not exists deposits_link_id_idx on deposits (link_id);

-- A single-use link (an invoice) closes after one payment; the default stays
-- a reusable page. callback_url returns the payer to the merchant's site.
alter table payment_links add column if not exists single_use boolean not null default false;
alter table payment_links add column if not exists callback_url text;
