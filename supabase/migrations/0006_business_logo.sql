-- Checkout branding lives on the business, not on each Payment Link.
alter table merchants add column if not exists logo_data_url text;
