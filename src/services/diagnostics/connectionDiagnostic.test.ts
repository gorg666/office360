import { createConnectionDiagnostic, redactDiagnosticText } from "./index";

describe("createConnectionDiagnostic", () => {
  it("maps password auth failure to invalid credentials", () => {
    const diagnostic = createConnectionDiagnostic("authentication failed: invalid password", {
      layer: "imap",
      operation: "test_connection",
      provider: "imap",
      authMethod: "password",
    });

    expect(diagnostic.reason).toBe("invalid_credentials");
    expect(diagnostic.userAction).toBe("check_password");
    expect(diagnostic.retryable).toBe(false);
  });

  it("maps mixed-case password auth failure to invalid credentials", () => {
    const diagnostic = createConnectionDiagnostic("Authentication Failed: Invalid Password", {
      layer: "imap",
      operation: "test_connection",
      provider: "imap",
      authMethod: "password",
    });

    expect(diagnostic.reason).toBe("invalid_credentials");
    expect(diagnostic.userAction).toBe("check_password");
  });

  it("maps oauth token failures to reauth", () => {
    const diagnostic = createConnectionDiagnostic("invalid_grant refresh token expired", {
      layer: "oauth",
      operation: "refresh",
      provider: "imap",
      authMethod: "oauth2",
    });

    expect(diagnostic.reason).toBe("expired_token");
    expect(diagnostic.userAction).toBe("reauth");
  });

  it("does not classify TLS failures as password problems", () => {
    const diagnostic = createConnectionDiagnostic("TLS handshake failed: certificate verify failed", {
      layer: "smtp",
      operation: "test_connection",
      provider: "imap",
      authMethod: "password",
    });

    expect(diagnostic.reason).toBe("tls_failed");
    expect(diagnostic.userAction).toBe("check_tls");
  });

  it("marks timeout as retryable", () => {
    const diagnostic = createConnectionDiagnostic("SMTP test timed out after 20 seconds", {
      layer: "smtp",
      operation: "test_connection",
      provider: "imap",
    });

    expect(diagnostic.reason).toBe("timeout");
    expect(diagnostic.retryable).toBe(true);
    expect(diagnostic.retryState).toBe("scheduled");
  });

  it("maps database lock to local database error", () => {
    const diagnostic = createConnectionDiagnostic("database is locked (code: 5)", {
      layer: "database",
      operation: "sync",
      provider: "imap",
    });

    expect(diagnostic.reason).toBe("local_database_error");
    expect(diagnostic.userAction).toBe("retry");
  });

  it("uses provider_error fallback for unclassified provider failures", () => {
    const diagnostic = createConnectionDiagnostic("unexpected upstream failure", {
      layer: "provider",
      operation: "sync",
      provider: "imap",
    });

    expect(diagnostic.reason).toBe("provider_error");
    expect(diagnostic.userAction).toBe("retry");
  });

  it("redacts raw cause before returning diagnostics", () => {
    const diagnostic = createConnectionDiagnostic("refresh_token: supersecret\nSubject: Private mail", {
      layer: "oauth",
      operation: "refresh",
      provider: "imap",
      authMethod: "oauth2",
    });

    expect(diagnostic.rawCause).not.toContain("supersecret");
    expect(diagnostic.rawCause).not.toContain("Private mail");
  });
});

describe("redactDiagnosticText", () => {
  it("redacts secrets and raw mail-like headers", () => {
    const result = redactDiagnosticText(
      'Authorization: Bearer abc.def password="secret" refresh_token: "supersecretrefresh"\nSubject: Private mail',
    );

    expect(result).not.toContain("abc.def");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("supersecretrefresh");
    expect(result).not.toContain("Private mail");
  });

  it("redacts raw mail headers without regex runtime errors", () => {
    const result = redactDiagnosticText("From: alice@example.com\nTo: bob@example.com\nReceived: secret-hop\nbody kept");

    expect(result).toContain("[redacted-mail]");
    expect(result).not.toContain("alice@example.com");
    expect(result).not.toContain("secret-hop");
  });
});
