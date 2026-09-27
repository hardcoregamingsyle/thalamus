-- admit_request: in one statement, refills and consumes the account's token
-- bucket per its plan, then takes the per-user write lease (docs/architecture.md
-- §5 step 3, §6 "Single writer"). Row locks (FOR UPDATE) make concurrent
-- calls for the same account or user_key serialize instead of racing.
--
-- Returns exactly one row: {status, retry_after_seconds}.
--   status = 'ok'           the request may proceed; the lease is now held
--                           by p_request_id.
--   status = 'rate_limited' the token bucket had no token to spend;
--                           retry_after_seconds says how long until one
--                           refills. No lease is touched.
--   status = 'lease_held'   another request still holds the user's lease;
--                           the token that was about to be spent is refunded.
--                           retry_after_seconds says when that lease expires.
--
-- A repeat call with the same (user_key, request_id) as the current lease
-- holder is treated as 'ok' and simply extends the lease — this is what
-- lets the gateway retry its own in-flight request without deadlocking on
-- its own lease.
CREATE OR REPLACE FUNCTION admit_request(
  p_account_id uuid,
  p_user_key text,
  p_request_id text,
  p_now timestamptz
)
RETURNS TABLE(status text, retry_after_seconds integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_requests_per_minute integer;
  v_burst integer;
  v_refill_per_second double precision;
  v_tokens double precision;
  v_updated_at timestamptz;
  v_elapsed_seconds double precision;
  v_new_tokens double precision;
  v_retry_after integer;
  v_lease_request_id text;
  v_lease_expires_at timestamptz;
BEGIN
  SELECT p.requests_per_minute, p.burst
    INTO v_requests_per_minute, v_burst
  FROM accounts a
  JOIN plans p ON p.id = a.plan
  WHERE a.id = p_account_id;

  IF NOT FOUND THEN
    -- No plan to admit against: fail closed rather than let the request
    -- through unmetered.
    RETURN QUERY SELECT 'rate_limited'::text, 3600;
    RETURN;
  END IF;

  v_refill_per_second := v_requests_per_minute / 60.0;

  -- Create the bucket on first use, full, then lock it for this update.
  INSERT INTO rate_buckets (account_id, tokens, updated_at)
  VALUES (p_account_id, v_burst, p_now)
  ON CONFLICT (account_id) DO NOTHING;

  SELECT tokens, updated_at INTO v_tokens, v_updated_at
  FROM rate_buckets
  WHERE account_id = p_account_id
  FOR UPDATE;

  v_elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (p_now - v_updated_at)));
  v_new_tokens := LEAST(v_burst::double precision, v_tokens + v_elapsed_seconds * v_refill_per_second);

  IF v_new_tokens < 1 THEN
    UPDATE rate_buckets SET tokens = v_new_tokens, updated_at = p_now
    WHERE account_id = p_account_id;

    IF v_refill_per_second > 0 THEN
      v_retry_after := CEIL((1 - v_new_tokens) / v_refill_per_second)::integer;
    ELSE
      v_retry_after := 3600;
    END IF;

    RETURN QUERY SELECT 'rate_limited'::text, v_retry_after;
    RETURN;
  END IF;

  -- Spend the token now; a lease conflict below refunds it.
  UPDATE rate_buckets SET tokens = v_new_tokens - 1, updated_at = p_now
  WHERE account_id = p_account_id;

  SELECT request_id, expires_at INTO v_lease_request_id, v_lease_expires_at
  FROM user_leases
  WHERE user_key = p_user_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO user_leases (user_key, request_id, expires_at)
    VALUES (p_user_key, p_request_id, p_now + interval '15 minutes');
    RETURN QUERY SELECT 'ok'::text, NULL::integer;
    RETURN;
  END IF;

  IF v_lease_request_id = p_request_id THEN
    UPDATE user_leases SET expires_at = p_now + interval '15 minutes'
    WHERE user_key = p_user_key;
    RETURN QUERY SELECT 'ok'::text, NULL::integer;
    RETURN;
  END IF;

  IF v_lease_expires_at <= p_now THEN
    UPDATE user_leases SET request_id = p_request_id, expires_at = p_now + interval '15 minutes'
    WHERE user_key = p_user_key;
    RETURN QUERY SELECT 'ok'::text, NULL::integer;
    RETURN;
  END IF;

  -- Another request still holds the lease: refund the token we spent above
  -- since this request cannot proceed.
  UPDATE rate_buckets SET tokens = v_new_tokens, updated_at = p_now
  WHERE account_id = p_account_id;

  v_retry_after := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_lease_expires_at - p_now)))::integer);
  RETURN QUERY SELECT 'lease_held'::text, v_retry_after;
END;
$$;
--> statement-breakpoint

-- release_lease: releases the per-user lease, but only if p_request_id is
-- still the current holder, so a late release from a superseded request
-- can't drop a lease someone else has since taken. Returns whether it
-- released anything.
CREATE OR REPLACE FUNCTION release_lease(
  p_user_key text,
  p_request_id text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM user_leases
  WHERE user_key = p_user_key AND request_id = p_request_id;
  RETURN FOUND;
END;
$$;
