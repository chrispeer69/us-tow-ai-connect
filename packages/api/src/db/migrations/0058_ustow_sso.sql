-- SSO: "Sign in with US Tow" identity links.
--
-- users.sso_sub        the SSO subject stamped on first US Tow sign-in. The
--                      person is still matched by email (case-insensitive);
--                      this is the audit link back to the identity provider.
-- tenants.sso_org_slug the SSO organisation (`org_slug` claim) a tenant maps
--                      to. Someone signing in from that org is auto-joined to
--                      the tenant. Null = unmapped; sign-in then falls back to
--                      matching slugify(company_name) against the claim.

alter table users add column if not exists sso_sub varchar(255);
create index if not exists users_sso_sub_idx on users (sso_sub);

alter table tenants add column if not exists sso_org_slug varchar(120);
create unique index if not exists tenants_sso_org_slug_idx
  on tenants (sso_org_slug)
  where sso_org_slug is not null;
