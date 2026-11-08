// src/lib/tracker-platforms/adapters/yggreborn.ts
//
// YGG Reborn has no personal-stats API (its /api is Torznab only). The account
// page (/account/) is server-rendered, so stats are scraped from its HTML with
// the browser session cookies.
//
// Markup (verified 2026-09): <div ...>361.61 Go</div><div ...>Upload</div>

import { computeBufferBytes, computeRatio } from "@/lib/data-transforms"
import type { DebugApiCall, FetchOptions, TrackerAdapter, TrackerStats } from "../contract"
import { fetchTrackerHtml } from "../helpers/html-fetch"

const UNIT_POWER: Record<string, number> = { "": 0, K: 1, M: 2, G: 3, T: 4, P: 5 }

function parseSize(raw: string): bigint {
  const m = raw.trim().match(/^([\d\s.,]+)\s*([KMGTP]?)(?:i?[oB])$/i)
  if (!m) throw new Error(`YGG Reborn: unrecognised size "${raw}"`)
  const value = Number.parseFloat(m[1].replace(/\s/g, "").replace(",", "."))
  const power = UNIT_POWER[m[2].toUpperCase()] ?? 0
  return BigInt(Math.round(value * 1024 ** power))
}

function statBefore(html: string, label: string): string | null {
  const re = new RegExp(`>\\s*([^<>]{1,40}?)\\s*</div>\\s*<div[^>]*>\\s*${label}\\s*</div>`, "i")
  return html.match(re)?.[1] ?? null
}

/** Accepts the stored JSON blob ({ cookies, userAgent }) or a raw Cookie header (older rows). */
function credentials(apiToken: string): { cookies: string; userAgent?: string } {
  const raw = apiToken.trim()
  let cookies = raw
  let userAgent: string | undefined
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { cookies?: string; userAgent?: string }
      cookies = parsed.cookies ?? ""
      userAgent = parsed.userAgent || undefined
    } catch {
      throw new Error("YGG Reborn: stored credentials are unreadable, paste the cookies again")
    }
  }
  cookies = cookies.trim().replace(/^cookie:\s*/i, "")
  if (!cookies || /[\r\n]/.test(cookies)) {
    throw new Error("YGG Reborn: paste the Cookie header value on a single line")
  }
  return { cookies, userAgent }
}

async function fetchAccountHtml(baseUrl: string, apiToken: string, apiPath: string, options?: FetchOptions) {
  const { cookies, userAgent } = credentials(apiToken)
  return fetchTrackerHtml({
    url: new URL(apiPath || "/account/", baseUrl).toString(),
    cookies,
    userAgent,
    label: "YGG Reborn",
    sessionExpiredMessage: "YGG Reborn: session expired, paste fresh browser cookies",
    proxyAgent: options?.proxyAgent,
    flaresolverr: options?.flaresolverr ? { config: options.flaresolverr } : undefined,
  })
}

export class YggRebornAdapter implements TrackerAdapter {
  async fetchStats(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<TrackerStats> {
    const html = await fetchAccountHtml(baseUrl, apiToken, apiPath, options)

    const up = statBefore(html, "Upload")
    const down = statBefore(html, "Download")
    if (!up || !down) {
      throw new Error("YGG Reborn: stats not found, session cookie probably expired, paste a fresh one")
    }
    const uploadedBytes = parseSize(up)
    const downloadedBytes = parseSize(down)

    const ratioRaw = statBefore(html, "Ratio")
    const ratioNum = ratioRaw ? Number.parseFloat(ratioRaw.replace(/\s/g, "").replace(",", ".")) : Number.NaN

    const username =
      html.match(/Bienvenue,\s*(?:<[^>]+>\s*)*([^<\s]+)/i)?.[1] ??
      html.match(/Nom d'utilisateur\s*<\/[^>]+>\s*(?:<[^>]+>\s*)*([^<\s]+)/i)?.[1] ??
      "unknown"

    return {
      username,
      group: "Membre",
      uploadedBytes,
      downloadedBytes,
      ratio: Number.isFinite(ratioNum) ? ratioNum : computeRatio(uploadedBytes, downloadedBytes),
      bufferBytes: computeBufferBytes(uploadedBytes, downloadedBytes),
      seedingCount: null,
      leechingCount: null,
      seedbonus: null,
      hitAndRuns: null,
      requiredRatio: null,
      warned: null,
      freeleechTokens: null,
    }
  }

  async fetchRaw(
    baseUrl: string,
    apiToken: string,
    apiPath: string,
    options?: FetchOptions
  ): Promise<DebugApiCall[]> {
    try {
      const html = await fetchAccountHtml(baseUrl, apiToken, apiPath, options)
      const data = {
        upload: statBefore(html, "Upload"),
        download: statBefore(html, "Download"),
        freeleechDl: statBefore(html, "Freeleech DL"),
        ratio: statBefore(html, "Ratio"),
      }
      return [{ label: "Account page", endpoint: apiPath, data, error: null }]
    } catch (err) {
      return [
        { label: "Account page", endpoint: apiPath, data: null, error: err instanceof Error ? err.message : "Request failed" },
      ]
    }
  }
}
