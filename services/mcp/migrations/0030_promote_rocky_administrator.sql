-- Promote every protected Rocky identity to full MXGenius application access.
-- Authentication remains owned by Entra; this migration only changes the
-- tenant-scoped application role after a verified identity has signed in.

UPDATE beta_access_rules
SET member_role = 'administrator'
WHERE rule IN ('rocky@mxgenius.io', 'hagy2392@gmail.com');

UPDATE organization_memberships AS membership
SET role = 'administrator'
FROM users AS app_user
WHERE membership.user_id = app_user.id
  AND lower(app_user.email) IN ('rocky@mxgenius.io', 'hagy2392@gmail.com')
  AND EXISTS (
      SELECT 1
      FROM beta_access_rules AS access_rule
      WHERE access_rule.organization_id = membership.organization_id
        AND access_rule.rule = lower(app_user.email)
        AND access_rule.member_role = 'administrator'
  );
