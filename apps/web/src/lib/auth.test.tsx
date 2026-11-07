/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { AuthProvider, useAuth } from "@/lib/auth";

function Consumer() {
  const { loading, authenticated, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="auth">{String(authenticated)}</span>
      <button onClick={() => login("u", "p").catch(() => {})}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe("AuthProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it("initial /auth/me check sets authenticated false on 401", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/auth/csrf")) {
        return Promise.resolve({ ok: true, json: async () => ({ csrf_token: "t1" }) });
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("auth").textContent).toBe("false");
  });

  it("initial /auth/me check sets authenticated true on 200", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/auth/csrf")) {
        return Promise.resolve({ ok: true, json: async () => ({ csrf_token: "t1" }) });
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve({ ok: true, status: 200 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("auth").textContent).toBe("true");
  });

  it("successful login sets authenticated true", async () => {
    (global.fetch as any).mockImplementation((url: string, opts?: any) => {
      if (url.includes("/auth/csrf")) {
        return Promise.resolve({ ok: true, json: async () => ({ csrf_token: "t1" }) });
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      if (url.includes("/auth/login")) {
        return Promise.resolve({ ok: true, status: 200 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    fireEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("auth").textContent).toBe("true"));
  });

  it("invalid credentials keeps unauthenticated", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/auth/csrf")) {
        return Promise.resolve({ ok: true, json: async () => ({ csrf_token: "t1" }) });
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      if (url.includes("/auth/login")) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    fireEvent.click(screen.getByText("login"));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("auth").textContent).toBe("false");
  });

  it("429 response path does not crash", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/auth/csrf")) {
        return Promise.resolve({ ok: true, json: async () => ({ csrf_token: "t1" }) });
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      if (url.includes("/auth/login")) {
        return Promise.resolve({ ok: false, status: 429 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    fireEvent.click(screen.getByText("login"));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("auth").textContent).toBe("false");
  });

  it("logout sets unauthenticated", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/auth/csrf")) {
        return Promise.resolve({ ok: true, json: async () => ({ csrf_token: "t1" }) });
      }
      if (url.includes("/auth/me")) {
        return Promise.resolve({ ok: true, status: 200 });
      }
      if (url.includes("/auth/logout")) {
        return Promise.resolve({ ok: true, status: 204 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("auth").textContent).toBe("true"));
    fireEvent.click(screen.getByText("logout"));
    await waitFor(() => expect(screen.getByTestId("auth").textContent).toBe("false"));
  });
});
