alter table tenant_credentials
  add column if not exists automatic_outbound_voice_enabled boolean;
