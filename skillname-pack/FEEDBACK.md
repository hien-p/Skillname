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

### B-001 — [DATE] — [Severity]
**Tool / endpoint:** [...]
**Steps to reproduce:**
1. [...]
2. [...]
3. [...]
**Expected:** [...]
**Actual:** [...]
**Workaround:** [...]
**Logs / tx hash / screenshot:** [link]

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
