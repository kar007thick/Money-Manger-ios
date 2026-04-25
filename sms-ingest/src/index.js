export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==============================
    // 1️⃣ INGEST ENDPOINT (iOS)
    // ==============================
    if (url.pathname === "/") {
      if (request.method !== "POST") {
        return new Response("Only POST allowed", { status: 405 });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const { user_id, raw_message, received_at, source } = body;

      if (!user_id || !raw_message || !received_at) {
        return new Response("Missing required fields: user_id, raw_message, received_at", { status: 400 });
      }

      // Validate raw_message is string and has content
      if (typeof raw_message !== 'string' || raw_message.trim().length === 0) {
        return new Response("raw_message must be a non-empty string", { status: 400 });
      }

      // Create dedup hash
      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          `${user_id}-${received_at}-${raw_message}`
        )
      );

      const key = [...new Uint8Array(hashBuffer)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      console.log(`[SMS-INGEST] Received message - user: ${user_id}, hash: ${key.substring(0, 16)}...`);

      // Check if already ingested
      const existing = await env.SMS_KV.get(key);
      if (existing) {
        console.log(`[SMS-INGEST] ✓ Duplicate detected - hash: ${key.substring(0, 16)}...`);
        return Response.json({ 
          ok: true, 
          deduped: true,
          message: "Message already ingested"
        });
      }

      // Store in KV with 7-day TTL
      const payload = {
        user_id,
        raw_message,
        received_at,
        source: source || "ios_shortcut",
        ingested_at: new Date().toISOString(),
        dedup_hash: key
      };

      await env.SMS_KV.put(
        key,
        JSON.stringify(payload),
        { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
      );

      console.log(`[SMS-INGEST] ✓ Message stored - length: ${raw_message.length} chars`);

      return Response.json({ 
        ok: true, 
        deduped: false,
        message: "Message ingested successfully",
        hash: key.substring(0, 16)
      });
    }

    // ==============================
    // 2️⃣ POLL ENDPOINT (Render backend)
    // ==============================
    if (url.pathname === "/poll") {
      // Validate API key
      const apiKey = request.headers.get("x-api-key");
      const expectedKey = env.POLL_API_KEY || "ios_secret_key_123";
      
      if (!apiKey || apiKey !== expectedKey) {
        console.warn(`[SMS-POLL] ❌ Unauthorized poll attempt`);
        return new Response("Unauthorized", { status: 401 });
      }

      console.log(`[SMS-POLL] Poll request received`);

      try {
        // List all pending messages (limit 100)
        const list = await env.SMS_KV.list({ limit: 100 });
        const messages = [];

        for (const key of list.keys) {
          const value = await env.SMS_KV.get(key.name);
          if (value) {
            try {
              messages.push({
                id: key.name,
                data: JSON.parse(value)
              });
            } catch (parseErr) {
              console.error(`[SMS-POLL] Failed to parse KV value for key: ${key.name}`);
            }
          }
        }

        console.log(`[SMS-POLL] ✓ Returning ${messages.length} pending messages`);

        return Response.json({ 
          ok: true,
          count: messages.length,
          messages 
        });
      } catch (err) {
        console.error(`[SMS-POLL] Error listing KV messages:`, err);
        return Response.json({ 
          ok: false, 
          error: err.message 
        }, { status: 500 });
      }
    }

    // ==============================
    // 3️⃣ DELETE ENDPOINT (cleanup after processing)
    // ==============================
    if (url.pathname === "/delete" && request.method === "POST") {
      const apiKey = request.headers.get("x-api-key");
      const expectedKey = env.POLL_API_KEY || "ios_secret_key_123";
      
      if (!apiKey || apiKey !== expectedKey) {
        return new Response("Unauthorized", { status: 401 });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const { id } = body;
      if (!id) {
        return new Response("Missing id", { status: 400 });
      }

      try {
        await env.SMS_KV.delete(id);
        console.log(`[SMS-DELETE] ✓ Deleted key: ${id.substring(0, 16)}...`);
        return Response.json({ ok: true, message: "Message deleted" });
      } catch (err) {
        console.error(`[SMS-DELETE] Failed to delete:`, err);
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};