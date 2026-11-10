-- Cursor Desktop OAuth: narrowly authorize one pre-registered Cursor client.
-- Existing Grok dynamic registration and consent rules are preserved.
-- No dispatch flags, queue records, or application statuses are changed.
-- This migration is not deployed merely by committing this file.

CREATE OR REPLACE FUNCTION jobbot.validate_grok_oauth_client(
  p_client_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_client auth.oauth_clients;
  v_consent auth.oauth_consents;
  v_uris text[];
  v_is_grok boolean;
  v_is_cursor boolean;
BEGIN
  IF p_user_id IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid
     OR p_client_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_client
  FROM auth.oauth_clients
  WHERE id = p_client_id AND deleted_at IS NULL;

  IF NOT FOUND OR v_client.redirect_uris IS NULL THEN
    RETURN false;
  END IF;

  v_uris := string_to_array(v_client.redirect_uris, ',');

  -- Preserve the established dynamic Grok policy and verified callback.
  v_is_grok := coalesce(v_client.client_name, '') ~* '^Grok'
    AND 'https://grok.com/connectors-oauth-exchange-code/' = ANY(v_uris);

  -- Cursor must match its individually reviewed client ID, exact name,
  -- and exact registered HTTPS callback. Reject arbitrary Cursor clients.
  v_is_cursor := p_client_id = 'cad36a3f-674b-464f-a90f-8ab9b661218d'::uuid
    AND v_client.client_name = 'Cursor'
    AND 'https://www.cursor.com/agents/mcp/oauth/callback' = ANY(v_uris);

  IF NOT (v_is_grok OR v_is_cursor) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_consent
  FROM auth.oauth_consents
  WHERE user_id = p_user_id
    AND client_id = p_client_id
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION jobbot.validate_grok_oauth_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobbot.validate_grok_oauth_client(uuid, uuid) TO authenticated, service_role;

-- The existing public.jf_validate_grok_oauth_client RPC and MCP Edge
-- Function already delegate to jobbot.validate_grok_oauth_client;
-- no changes to the protected MCP tools are required for this gate.
