import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { jsonBody } from "../src/auth-api.js";

const app = new Hono();
app.onError((e, c) => c.json({ error: e.message }, 400));
app.post("/body", async (c) => c.json(await jsonBody(c)));

async function submit(contentType: string) {
  return app.request("/body", {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify({ accepted: true }),
  });
}

describe("JSON media type admission", () => {
  it.each(["application/json", "application/json; charset=utf-8", "APPLICATION/JSON; Charset=UTF-8"])(
    "accepts %s",
    async (contentType) => {
      const res = await submit(contentType);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted: true });
    },
  );

  it.each(["application/jsonp", "application/json-patch+json", "text/plain", "application/jsoninvalid"])(
    "rejects %s rather than accepting a JSON prefix",
    async (contentType) => {
      const res = await submit(contentType);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "request body must be JSON" });
    },
  );
});
