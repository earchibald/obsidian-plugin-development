// Pattern: keep non-trivial logic in pure modules that depend only on narrow
// structural interfaces. `main.ts` builds concrete impls backed by Obsidian
// APIs; vitest tests pass plain-object fakes. No `obsidian` import in this
// file — that's the point.

export interface HttpRequest {
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
}

export interface HttpResponse {
  status: number;
  text: string;
  json: unknown;
}

export interface VaultAdapter {
  read(path: string): Promise<string>;
  modify(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// --- Pure business logic ---

export async function fetchIssueSummary(
  http: HttpRequest,
  baseUrl: string,
  token: string,
  key: string,
): Promise<string | null> {
  const r = await http.get(`${baseUrl}/rest/api/2/issue/${key}`, {
    Authorization: `Bearer ${token}`,
  });
  if (r.status !== 200) return null;
  const body = r.json as { fields?: { summary?: string } };
  return body.fields?.summary ?? null;
}

// --- Test (vitest) ---
//
//   import { describe, it, expect } from "vitest";
//   import { fetchIssueSummary, HttpRequest } from "./adapter-pattern";
//
//   const fake: HttpRequest = {
//     async get() {
//       return { status: 200, text: "", json: { fields: { summary: "Hi" } } };
//     },
//   };
//
//   describe("fetchIssueSummary", () => {
//     it("returns the summary field", async () => {
//       expect(await fetchIssueSummary(fake, "x", "t", "K-1")).toBe("Hi");
//     });
//   });
//
// --- Concrete impl wired in main.ts ---
//
//   import { requestUrl } from "obsidian";
//   const http: HttpRequest = {
//     async get(url, headers) {
//       const r = await requestUrl({ url, headers, throw: false });
//       return { status: r.status, text: r.text, json: r.json };
//     },
//   };
