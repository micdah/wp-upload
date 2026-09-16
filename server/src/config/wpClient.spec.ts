import type { AxiosResponse } from "axios"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  checkConnection,
  connectionState,
  invalidateConnection,
  refreshConnectionIfStale,
  wpAxios,
} from "./wpClient.ts"

const INITIAL_STATE = {
  connected: false,
  user: null,
  reason: null,
  lastCheckedAt: null,
}

// Plain describe: checkConnection/refreshConnectionIfStale await a mocked
// network call while mutating the shared `connectionState` singleton, so
// concurrent tests could interleave mid-check and observe a half-updated
// state.
describe("wpClient", () => {
  beforeEach(() => {
    Object.assign(connectionState, INITIAL_STATE)
  })

  describe("checkConnection", () => {
    it("marks the connection healthy on a successful self-check", async () => {
      vi.spyOn(wpAxios, "get").mockResolvedValue({
        data: { name: "Jane" },
      } as unknown as AxiosResponse)

      await checkConnection()

      expect(connectionState).toMatchObject({
        connected: true,
        user: "Jane",
        reason: null,
      })
      expect(connectionState.lastCheckedAt).not.toBeNull()
    })

    it("falls back to the configured username when WordPress omits a display name", async () => {
      vi.spyOn(wpAxios, "get").mockResolvedValue({
        data: {},
      } as unknown as AxiosResponse)

      await checkConnection()

      expect(connectionState.user).toBe("test-user")
    })

    it("records a credential-rejected reason on 401/403", async () => {
      vi.spyOn(wpAxios, "get").mockRejectedValue({
        isAxiosError: true,
        response: { status: 401 },
      })

      await checkConnection()

      expect(connectionState).toMatchObject({
        connected: false,
        reason: "WordPress rejected the configured credentials.",
      })
    })

    it("records the HTTP status for other error responses", async () => {
      vi.spyOn(wpAxios, "get").mockRejectedValue({
        isAxiosError: true,
        response: { status: 500 },
      })

      await checkConnection()

      expect(connectionState.reason).toContain("HTTP 500")
    })

    it("records an unreachable reason when there is no response", async () => {
      vi.spyOn(wpAxios, "get").mockRejectedValue({
        isAxiosError: true,
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED",
      })

      await checkConnection()

      expect(connectionState.reason).toContain("ECONNREFUSED")
    })

    it("records a message-based reason for a non-axios error", async () => {
      vi.spyOn(wpAxios, "get").mockRejectedValue(new Error("boom"))

      await checkConnection()

      expect(connectionState.reason).toContain("boom")
    })

    it("dedupes overlapping calls into a single underlying request", async () => {
      let resolveGet: (value: AxiosResponse) => void = () => {}
      const pending = new Promise<AxiosResponse>((resolve) => {
        resolveGet = resolve
      })
      const get = vi.spyOn(wpAxios, "get").mockReturnValue(pending)

      const first = checkConnection()
      const second = checkConnection()
      resolveGet({ data: { name: "Jane" } } as unknown as AxiosResponse)
      await Promise.all([first, second])

      expect(get).toHaveBeenCalledTimes(1)
    })
  })

  describe("refreshConnectionIfStale", () => {
    it("does nothing when the last check is recent", () => {
      connectionState.lastCheckedAt = Date.now()
      const get = vi.spyOn(wpAxios, "get")

      refreshConnectionIfStale()

      expect(get).not.toHaveBeenCalled()
    })

    it("triggers a check when there has never been one", () => {
      connectionState.lastCheckedAt = null
      const get = vi
        .spyOn(wpAxios, "get")
        .mockResolvedValue({ data: {} } as unknown as AxiosResponse)

      refreshConnectionIfStale()

      expect(get).toHaveBeenCalledTimes(1)
    })

    it("triggers a check when the last one is stale", () => {
      connectionState.lastCheckedAt = Date.now() - 3 * 60 * 1000
      const get = vi
        .spyOn(wpAxios, "get")
        .mockResolvedValue({ data: {} } as unknown as AxiosResponse)

      refreshConnectionIfStale()

      expect(get).toHaveBeenCalledTimes(1)
    })
  })

  describe("invalidateConnection", () => {
    it("marks the connection down with the given reason", () => {
      connectionState.connected = true
      invalidateConnection("credentials rejected")

      expect(connectionState).toMatchObject({
        connected: false,
        user: null,
        reason: "credentials rejected",
      })
      expect(connectionState.lastCheckedAt).not.toBeNull()
    })
  })
})
