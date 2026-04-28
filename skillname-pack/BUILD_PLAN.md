# skillname — Full Build Plan (Team 3+, Aggressive, Apr 24 → May 6)

> **Locked config:** Team 3 · Aggressive risk · Storacha primary + 0G dual-pin · Target $10K+ across ENS (both) + KeeperHub + 0G, with Gensyn AXL or Uniswap as D11+ stretch.

---

## 0. Team roles (fixed, no swapping)

The 3-prize cap means we don't need 4 people, but parallelization is the entire point. Lock roles to avoid merge hell.

| Role | Owner | Domain | First commit by |
|---|---|---|---|
| **Lead / Bridge** | **Jason** | MCP Bridge, ENS resolver, SDK, demo orchestration | D1 EOD |
| **Execution** | **Dev B** | KeeperHub MCP, x402, OpenClaw packaging, smart contracts (if any) | D1 EOD |
| **Storage + Identity** | **Dev C** | Storacha + 0G storage, Schema validator, ENSIP-25, ERC-8004, Web/explorer | D1 EOD |

**Communication:** daily 15-min standup at 10am Hanoi (UTC+7). Async Slack/Discord channel for blockers. PR review SLA: 4 hours.

**Branch policy:** trunk-based. Feature branches `<role>/<topic>`. Main always demo-able. Force a tag every EOD: `tag-d1-eod`, `tag-d2-eod` — gives clean rollback if Dev B's KeeperHub branch breaks Jason's demo.

---

## 1. North star (no team should forget this)

**One sentence:** Every protocol/agent gets an ENS name; text record points to a content-addressed skill bundle on IPFS/0G; any MCP client resolves the name and dynamically loads MCP tools.

**Demo line:** *"Watch Claude get DeepBook tools in 3 seconds without any code change. Just `Use deepbook.eth`."*

**Hard non-negotiables:**
- Real ENS resolution at runtime (no hard-coded values — ENS prize page calls this out twice)
- 2–4 min demo video, ≥720p, no AI voiceover
- FEEDBACK.md at repo root from D1 (KeeperHub gate)
- 3 partner prizes max in submission: **ENS + KeeperHub + 0G**

---

## 2. Phase plan (parallel, 14 days)

### Phase P0 — MVP (D1–D7)

Everyone contributes. **Kill-criteria at D5 EOD: Claude Desktop loads tools from `test.<...>.eth` dynamically.**

| Day | Jason (Lead/Bridge) | Dev B (Execution) | Dev C (Storage/Identity) |
|---|---|---|---|
| **D1 Apr 24** | Repo init, monorepo scaffold, push README + FEEDBACK skeleton, register `skillname` (Sepolia) | KeeperHub account + API key + hello-world MCP test on Base Sepolia | Storacha + 0G + CDP accounts; install w3up-client; test upload |
| **D2 Apr 25** | Bridge: viem ENS resolver (`getEnsText`) + helia verified-fetch wrapper | KeeperHub MCP server local config; document tool surface in `EXECUTION.md` | Schema v1 written + validator + 3 fixture bundles + unit tests |
| **D3 Apr 26** | Bridge: dynamic MCP tool registration framework | x402 facilitator setup with CDP; Hono wrapper PoC | Storacha publish pipeline (`manifest publish ./bundle name.eth`) |
| **D4 Apr 27** | SDK package: `resolveSkill(ensName)` end-to-end; CLI `manifest resolve` | Begin keeperhub-paid wrapper service skeleton | 0G Storage adapter (parallel pin); CLI `manifest pack` |
| **D5 Apr 28** ⚠️ | **Wire Bridge into Claude Desktop config; smoke test live** | Watch Jason's Bridge work; assist | Web/explorer landing page Hello World |
| **D6 Apr 29** | Polish: caching, error handling, structured logs visible in demo | KeeperHub Tier 0: route 1 stub tool through `execute_contract_call` on Base Sepolia | Build `examples/research-agent/` bundle: `contract_scan` (local) + manifest.json |
| **D7 Apr 30** | E2E rehearsal: ENS → bundle → tools → call. Record P0 demo clip. | Tier 0 live: real tx on Base Sepolia from Claude prompt | ENSIP-25 spec read + 8004 reference impl read; sketch D10 plan |

### Phase P1 — Prize layer 1 (D8–D10)

| Day | Jason | Dev B | Dev C |
|---|---|---|---|
| **D8 May 1** | Bridge: route `execution.type === "keeperhub"` to Dev B's wrapper; integrate x402 challenge handling | KeeperHub Tier 1: `keeperhub-paid/` wrapper with `@x402/hono` middleware on Base Sepolia | Mint ERC-8004 Identity NFT; set `agent-registration[<reg>][<id>]` text record on test ENS |
| **D9 May 2** | Demo bundle v2: add `execute_contract_call` paid tool with `execution.payment` block | x402 EIP-3009 USDC `transferWithAuthorization` flow tested; receipts on BaseScan | Bridge `verifyEnsip25(ensName, bundle.trust.erc8004)` + verified badge in CLI/web |
| **D10 May 3** | Pre-record Day 12 demo skeleton; confirm everything green | OpenClaw skill packaging starter (`bundles/research-agent/openclaw.json`) | Web/explorer: ENS lookup form → resolve → render bundle + verified badge |

### Phase P2 — Prize layer 2 (D11–D12)

| Day | Jason | Dev B | Dev C |
|---|---|---|---|
| **D11 May 4** | Architecture diagram final; demo script word-for-word | OpenClaw `clawhub install skillname` working; FEEDBACK.md filled with KeeperHub items | 0G Storage dual-pin in publish pipeline; `xyz.manifest.skill.0g` text record |
| **D12 May 5** | **CODE FREEZE 6PM** · Demo recording (5 takes); upload to YouTube unlisted | Aggressive stretch: optional Uniswap V4 tool via KeeperHub workflow | iNFT (ERC-7857) optional mint of bundle; web explorer polish |

### Phase P3 — Submission (D13–D14)

| Day | Jason | Dev B | Dev C |
|---|---|---|---|
| **D13 May 6** | Submit on ETHGlobal Hacker Dashboard; pick 3 prize tracks | FEEDBACK.md final pass (3–5 specific items); push KeeperHub Discord | Draft ENSIP forum post → https://discuss.ens.domains/c/ai; web final |
| **D14 May 6 EOD** | Buffer + finalist live demo prep | Buffer | Buffer |

---

## 3. Aggressive stretch options (only after D10 green)

If KeeperHub + ENSIP-25 both stable by D10 EOD, pick ONE:

| Option | Effort | Adds | Risk |
|---|---|---|---|
| **Uniswap V4 swap demo** | 1 day | Big visual; Uniswap Foundation eligibility (need FEEDBACK.md gate) | Forces 4th prize track → submission cap blocks one of {ENS, KH, 0G} |
| **Gensyn AXL P2P** | 2 days | "Two agents discover each other's skills via ENS over AXL" — strongest ENS Most Creative angle | Hard requirement: 2 separate AXL nodes, not in-process |
| **Live mainnet demo** | 0.5 day | Cred bump | Costs real ETH; safer to skip |

**Recommendation:** Go Gensyn AXL only if Dev B + Dev C are both ahead by D10. Otherwise polish P0+P1+P2 to a mirror finish.

---

## 4. Kill-criteria + decision points

| Date | Checkpoint | Pass | Fail |
|---|---|---|---|
| **D5 EOD** | Claude Desktop loads tools from test ENS dynamically | → P1 | Cut KeeperHub + 0G + 8004; full team on MVP polish; submit ENS-only ($2.5K target) |
| **D7 EOD** | E2E MVP recording captured | → P1 | +1 day buffer; push P1 to D9 |
| **D9 EOD** | x402 receipt visible on BaseScan | → ENSIP-25 | Skip x402, plain KeeperHub MCP only |
| **D10 EOD** | ENSIP-25 binding verified on Agent Arena | → OpenClaw | Skip ENSIP-25; keep ENS Best AI Integration only |
| **D11 EOD** | OpenClaw `clawhub install` works | → demo prep | Drop OpenClaw; keep KeeperHub MCP wrapper |
| **D12 6PM** | Demo recorded | → submit | Push to D13; cut ENSIP draft |

---

## 5. Risk register

| Risk | P | Mitigation |
|---|---|---|
| Team merge conflicts on Bridge | M | Trunk-based, 4hr PR SLA, daily EOD tag |
| Storacha UCAN setup eats time | M | Pinata fallback ready; test D1 |
| KeeperHub MCP doesn't work on Base Sepolia | M | Verify D1 with hello-world; if broken → file feedback (counts toward bounty) + fall back to direct viem write |
| Claude Desktop doesn't reload MCP tools dynamically | M-H | Test D5 first; if broken → MCP Inspector + simple HTTP MCP client as control demo |
| ENS testnet resolution slow | L | Multicall + cache; mainnet fallback |
| Demo re-recording on D12 | M | 5 takes scheduled; script word-for-word D11 |
| Forget FEEDBACK.md → KeeperHub DQ | L | Skeleton D1, append daily |
| Jason burnt out (3 hackathons parallel) | H | Synthesis tasks paused D1–D7; First Movers async only; Dev B+C can carry MVP if Jason needs 1 day off |

---

## 6. Prize alignment matrix (final reference)

| Sponsor | Track | $ | Deliverable | Owner |
|---|---|---|---|---|
| **ENS** | Best AI Agent Integration | $2.5K | Runtime ENS resolution loads MCP tools, no hard-coded values | Jason |
| **ENS** | Most Creative Use | $2.5K | Text records as capability registry; ENSIP-25 binding; (stretch) ENSIP draft | Dev C |
| **KeeperHub** | Best Use | $2.5K | KeeperHub MCP wired; OpenClaw plugin; x402 payments | Dev B |
| **KeeperHub** | Builder Feedback Bounty | $250 | Specific UX/bug/doc/feature feedback | Dev B |
| **0G** | Agent Framework, Tooling & Core Extensions | $2.5K | manifest spec as framework; 0G Storage dual-pin; reference agent | Dev C + Jason |

**Total addressable:** ~$10,250. Realistic top-3 in 1–2 tracks: **$3K–$6K expected**.

---

## 7. The 24h pre-build (do TODAY before D1)

Three of you split this:

**Jason (3h):**
- [ ] Apply to Open Agents (deadline Apr 23 — apply NOW if not done)
- [ ] Block calendar D1–D14, defer non-critical First Movers tasks
- [ ] Pause Synthesis hackathon GrayBot tasks until D7 EOD
- [ ] Test Claude Desktop has MCP enabled with one stock server

**Dev B (2h):**
- [ ] Sign up KeeperHub, get API key, run hello-world MCP locally
- [ ] Sign up CDP (Coinbase Developer Platform), get x402 facilitator credentials
- [ ] Read https://docs.keeperhub.com/ + https://www.x402.org/ end-to-end

**Dev C (2h):**
- [ ] Sign up Storacha, run signup flow, save DID
- [ ] Sign up 0G, get testnet credentials
- [ ] Read ENSIP-25 spec + ERC-8004 EIP in full (https://docs.ens.domains/ensip/25, https://eips.ethereum.org/EIPS/eip-8004)

**All:**
- [ ] Get Sepolia ETH + Base Sepolia ETH/USDC (CDP faucet + Alchemy faucet)
- [ ] Pre-pick ENS test name (Sepolia)
- [ ] Add each other on Discord/Telegram

---

## 8. NOT building (scope discipline)

Future work in README, NOT in demo:

- ❌ Full reputation system (just mint 8004 NFT, no feedback loops)
- ❌ Full policy/access manager
- ❌ Marketplace UI
- ❌ Multiple protocols (1 demo bundle is enough — judges score depth not breadth)
- ❌ Subname-per-version locking (mention in ARCH only)
- ❌ Custom resolver contract (use ENS PublicResolver)
- ❌ FVM contracts
- ❌ AXL P2P unless D10 green and aggressive stretch picked

---

## 9. Day-1 unblock — copy-paste commands

See `setup-day1.sh`. Owner: Jason runs script, Dev B+C verify their accounts ready.

```bash
# After cloning:
chmod +x setup-day1.sh
./setup-day1.sh
```

---

## Appendix A — One-liner answers for judges (memorize)

| Question | Answer |
|---|---|
| What is this? | "ENS-native skill registry for AI agents. Protocols publish MCP tool bundles under their ENS name; agents resolve and load tools dynamically. No custom adapters." |
| Why ENS? | "Wallet-native ownership transferability + ENSIP-25 ERC-8004 composability. A JSON registry has neither." |
| What's new vs Anthropic MCP Registry? | "Complementary. Theirs is DNS/GitHub-anchored; ours is ENS-anchored with content-addressed bundles." |
| Versioning? | "Text record `xyz.manifest.skill.version` for latest pointer; immutable subnames `v1.deepbook.eth` for historical pins." |
| What if ENS Labs builds this? | "They publicly said they won't — January 2026 blog. We're claiming the slot with a draft ENSIP." |
| ENSIP-25 vs you? | "ENSIP-25 verifies an agent owns its name — 1 bit of data. We resolve that name into a working tool set — entire capability bundle on IPFS. We *use* ENSIP-25 for the verified badge; it doesn't replace the registry." |
| Why team of 3? | "Parallelization: Bridge, Execution, Identity each is a full vertical. Solo would force scope cuts in P2." |

---

**End of plan. Day 1 script + scaffold files in this same folder.**
