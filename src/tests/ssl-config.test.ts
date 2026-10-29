import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import tls from "tls";
import { normalizePem, sslSettingFromEnv } from "../config/ssl.config";

// A real public CA (Supabase root), from the gitignored certs folder of the sibling backend when present.
const certPath = path.resolve(__dirname, "../../../backend/certs/prod-ca-2021.crt");
const pem = fs.existsSync(certPath) ? fs.readFileSync(certPath, "utf8") : null;
const run = pem ? it : it.skip;

describe("database CA from hosting dashboards", () => {
  run("a certificate whose line breaks became spaces is rebuilt and accepted by TLS", () => {
    const flat = pem!.replace(/\n/g, " ");
    const fixed = normalizePem(flat);
    expect(fixed.replace(/\s/g, "")).toBe(pem!.replace(/\s/g, ""));
    expect(() => tls.createSecureContext({ ca: fixed })).not.toThrow();
  });
  run("literal \\n sequences are accepted", () => {
    const fixed = normalizePem(pem!.trim().replace(/\n/g, "\\n"));
    expect(() => tls.createSecureContext({ ca: fixed })).not.toThrow();
  });
  run("a certificate pasted into DATABASE_SSL_CA_FILE is used as the certificate", () => {
    const s = sslSettingFromEnv({ DATABASE_SSL_CA_FILE: pem!.replace(/\n/g, " ") } as NodeJS.ProcessEnv);
    expect(s.mode).toBe("pinned");
  });
  it("a missing CA file names the setting to use instead", () => {
    expect(() => sslSettingFromEnv({ DATABASE_SSL_CA_FILE: "./certs/missing.crt" } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_SSL_CA instead/
    );
  });
});
