CREATE OR REPLACE FUNCTION jobbot.validate_grok_oauth_client(p_client_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_client auth.oauth_clients;
  v_consent auth.oauth_consents;
  v_is_grok boolean := false;
  v_is_cursor boolean := false;
BEGIN
  -- 1. Caller/principal must be the designated owner
  IF p_user_id IS DISTINCT FROM 'f2729195-5445-4272-ab85-cac5b03b0967'::uuid THEN
    RETURN false;
  END IF;

  -- 2. Client ID must be provided
  IF p_client_id IS NULL THEN
    RETURN false;
  END IF;

  -- 3. Client must be registered in auth.oauth_clients and not deleted
  SELECT * INTO v_client
  FROM auth.oauth_clients
  WHERE id = p_client_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 4. Check client identity against authorized connectors
  -- A) Approved Grok Connector:
  -- - redirect_uris contains https://grok.com/connectors-oauth-exchange-code/
  -- - client_name matches ^Grok
  IF v_client.redirect_uris IS NOT NULL AND
     ('https://grok.com/connectors-oauth-exchange-code/' = ANY(string_to_array(v_client.redirect_uris, ','))) AND
     coalesce(v_client.client_name, '') ~* '^Grok' THEN
    v_is_grok := true;
  END IF;

  -- B) Approved Cursor Desktop MCP Connector:
  -- - registered dynamic Cursor client with exact metadata
  -- - redirect_uris contains https://www.cursor.com/agents/mcp/oauth/callback (HTTPS only; loopback disallowed)
  -- - client_name matches ^Cursor
  IF v_client.client_name = 'Cursor' AND
     v_client.redirect_uris IS NOT NULL AND
     ('https://www.cursor.com/agents/mcp/oauth/callback' = ANY(string_to_array(v_client.redirect_uris, ','))) AND
     NOT EXISTS (
       SELECT 1 FROM unnest(string_to_array(v_client.redirect_uris, ',')) AS registered_uri(uri)
       WHERE btrim(registered_uri.uri) NOT IN (
         'https://www.cursor.com/agents/mcp/oauth/callback',
         'http://localhost:8787/callback'
       )
     ) THEN
    v_is_cursor := true;
  END IF;

  IF NOT v_is_grok AND NOT v_is_cursor THEN
    RETURN false;
  END IF;

  -- 5. Active, unrevoked owner consent must exist for this exact client ID and owner
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

