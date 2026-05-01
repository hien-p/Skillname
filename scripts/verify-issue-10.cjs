'use strict'
// Verify issue #10 acceptance criteria are actually satisfied on-chain.
// Reads xyz.manifest.skill text record on each Sepolia subname and reports.

const { ethers } = require('ethers')

const RPC = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org'
const NAMES = [
  'hello.skilltest.eth',
  'quote.skilltest.eth',
  'swap.skilltest.eth',
  'score.skilltest.eth',
  'weather.skilltest.eth',
]

;(async () => {
  const provider = new ethers.JsonRpcProvider(RPC)

  console.log(`RPC: ${RPC}`)
  console.log(`Checking xyz.manifest.skill text record on:\n`)

  let pass = 0, fail = 0
  for (const name of NAMES) {
    try {
      const resolver = await provider.getResolver(name)
      if (!resolver) {
        console.log(`  ${name.padEnd(28)} ✗  no resolver`)
        fail++
        continue
      }
      const uri = await resolver.getText('xyz.manifest.skill')
      const ver = await resolver.getText('xyz.manifest.skill.version')
      if (uri) {
        console.log(`  ${name.padEnd(28)} ✓  uri=${uri.slice(0, 36)}…  v=${ver || '—'}`)
        pass++
      } else {
        console.log(`  ${name.padEnd(28)} ✗  text record empty`)
        fail++
      }
    } catch (e) {
      console.log(`  ${name.padEnd(28)} ✗  ${e.message}`)
      fail++
    }
  }
  console.log(`\n${pass}/${NAMES.length} resolve cleanly`)
  process.exit(fail > 0 ? 1 : 0)
})()
