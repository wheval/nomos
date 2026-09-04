-- Who an invoice is addressed to.
--
-- An invoice is billed to a named person, unlike a payment link which is
-- shared with whoever. Storing the address means the console can offer to send
-- it, and can show later who it went to.
--
-- Nullable: payment links have no customer, and older invoices predate this.
alter table payment_links add column if not exists customer_email text;

comment on column payment_links.customer_email is
  'Recipient of an invoice. Null for reusable payment links.';
