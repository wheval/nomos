-- Business display name (sidebar identity, Paystack-style) and an optional
-- IP allowlist on the secret key. Empty allowed_ips means "any IP" — same
-- as Paystack until the merchant opts in. Logo on a payment link is a
-- small data-URL so checkout can brand the page without a blob store.

alter table merchants add column if not exists display_name text;
alter table merchants add column if not exists allowed_ips text[] not null default '{}';
alter table payment_links add column if not exists logo_data_url text;
