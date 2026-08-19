-- Session 77 — who picked up the phone when the dialler gave up.
--
-- The red "call did not complete" card started life dismissible per DEVICE, in
-- localStorage. That is the wrong shape for a team: two admins both see the same
-- card, one calls the customer and hides it, and the second still sees it and
-- calls them again. Nobody could answer "did anyone actually ring Sue H.?"
--
-- A dismissal is therefore a real event, not a UI preference. One row per
-- intervention: it clears the card on every phone, and it is the audit trail for
-- whether an unreachable customer ever got a human call.

CREATE TABLE IF NOT EXISTS attention_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The outbound_calls row that ran out of attempts. UNIQUE because dismissing
  -- twice is not two interventions — and because two admins tapping ✕ at the
  -- same moment must not create two rows.
  outbound_call_id uuid NOT NULL UNIQUE,

  -- Who dealt with it. Free text rather than a user FK: the board is used by
  -- admin staff who may be on a shared login, and an approximate name recorded
  -- honestly beats a precise one we cannot actually determine.
  dismissed_by text,
  dismissed_at timestamptz NOT NULL DEFAULT now(),

  -- Optional: what happened when they called. Left open on purpose — the useful
  -- version of this field is whatever the person actually types.
  note text
);

CREATE INDEX IF NOT EXISTS attention_dismissals_tenant_idx
  ON attention_dismissals (tenant_id, dismissed_at DESC);
