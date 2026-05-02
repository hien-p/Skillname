# KeeperHub Builder Feedback

> ETHGlobal Open Agents 2026 · skillname team · Apr 24 – May 6, 2026
>
> This document is maintained throughout the hackathon. Each entry is dated, specific, and actionable per KeeperHub's bounty criteria.

---

## Summary

We integrated KeeperHub as the execution layer for our ENS-native skill registry. Tools declared as `execution.type === "keeperhub"` in our manifest spec route through KeeperHub's MCP server (`execute_contract_call`, `execute_transfer`). We also wrap KeeperHub behind an x402 payment middleware on Base Sepolia for pay-per-call agent monetization.

This document collects friction we hit, reproducible bugs, doc gaps that slowed us, and feature requests that would have made the build easier.

---

## 1. UX / UI friction

### F-001 — [DATE] — [Severity: low/med/high]

**Where:** [page/tool/screen]
**What confused us:** [specific description]
**What we expected:** [...]
**What happened:** [...]
**Time lost:** [estimate]
**Suggested fix:** [...]

<!-- Template above. Fill 2-3 entries during D8-D11. -->

---

## 2. Reproducible bugs

### B-001 — 2026-05-01 — High

**Tool / endpoint:** `execute_transfer` via `https://app.keeperhub.com/mcp`

**Steps to reproduce:**

1. Connect to KeeperHub MCP with `StreamableHTTPClientTransport` + Bearer token
2. Call `execute_transfer` with `{ network: "84532", to: "0x5c11...", amount: "0.01", token: "USDC" }`
3. Observe response

**Expected:** Execution ID returned, tx submitted on Base Sepolia

**Actual:** 502 Bad Gateway from `app.keeperhub.com`

**Workaround:** Retry later; no client-side fix possible.

**Logs / tx hash / screenshot:** Claude Desktop session, 2026-05-01 19:10 ICT — full x402 payment flow completed successfully up to the KeeperHub call.

**Update 2026-05-02:** After re-reading the KeeperHub MCP docs, the canonical execution path is workflow-based (`get_wallet_integration` → `create_workflow` → `execute_workflow`), not the standalone `execute_transfer` tool we originally tried. PR #55 refactored our integration to match the documented surface. The 502 in step 3 is consistent with calling a tool that doesn't exist on KeeperHub's MCP — they returned a generic gateway error rather than `MethodNotFound`. Worth surfacing the actual list of available tools in error responses, or making `tools/list` discovery more prominent in the docs.

### B-002 — 2026-05-02 — High

**Tool / endpoint:** `get_wallet_integration` via `https://app.keeperhub.com/mcp`

**Steps to reproduce:**

1. Connect to KeeperHub MCP with `StreamableHTTPClientTransport` + Bearer token
2. Call `tools/list` — observe `get_wallet_integration` is present in the response
3. Call `get_wallet_integration` with `arguments: {}` (the docs example shows no args)
4. Observe response

**Expected:** Either `(a)` returns the list of wallet integrations belonging to the account associated with the Bearer key, or `(b)` returns a clear `MissingRequiredParameter: <name>` error naming the field.

**Actual:** `MCP error -32602: Input validation error: Invalid arguments for tool get_wallet_integration: [{ "expected": "string", "code": "invalid_type" }]`. The validation error doesn't include `path`, so we can't see *which* field is required.

**Workaround:** None found. Tried `{ chain: "84532" }`, `{ network: "84532" }`, `{ name: "default" }` — all rejected with the same opaque error. Cannot proceed past the very first step of the workflow flow.

**Logs / tx hash / screenshot:** keeperhub-paid e2e run on 2026-05-02 — see PR #62 logs. The x402 challenge layer (`paymentMiddleware` + EIP-3009 signing + `wrapFetchWithPayment`) all pass; the request reaches our `/execute` handler and gets stuck on the very first KeeperHub call.

**Suggested fix:** Include the `path` array in `MCP error -32602` responses so the validation error indicates *which* argument is missing or wrong. Or, even better, accept `{}` and return all wallet integrations the Bearer key has access to — that's the natural "list" semantics.

<!-- Aim for 1-2 reproducible bugs. Even if minor, specificity wins. -->

---

## 3. Documentation gaps

### D-001 — [DATE]

**Doc page:** [URL]
**What we needed:** [...]
**What was missing:** [...]
**Where we eventually found it:** [Discord / source code / trial-and-error]
**Suggested addition:** [...]

<!-- Examples: missing TS types, unclear auth flow, no example for X. -->

---

## 4. Feature requests

### R-001 — [DATE]

**Use case:** [what we were building when we wished for this]
**Request:** [specific feature]
**Why this matters:** [downstream value]
**Acceptable workaround we used:** [...]

<!-- 1-2 well-justified requests beat 10 wishes. -->

---

## 5. What worked well

(Optional but recommended — shows we're not just complaining.)

- [...]
- [...]

---

## 6. Integration summary

**Tools used:** `execute_contract_call`, `execute_transfer` (and which workflow IDs)
**Networks:** Base Sepolia (primary), Sepolia (test)
**Payment integration:** x402 via `@x402/hono` middleware, CDP facilitator
**Framework integration:** OpenClaw skill packaging (`clawhub install skillname`)
**Total tx count during build:** [number]
**Approximate hours integrating:** [number]

---

## Contact

- **Team:** skillname
- **GitHub:** https://github.com/hien-p/Skillname
- **Demo:** https://skillname.eth.limo
- **Lead:** Jason / @hien-p (Discord)
