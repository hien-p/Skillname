#!/usr/bin/env node
// Stub CLI. Real verbs (init / publish / resolve / verify / lock) land in issue #17.

const cmd = process.argv[2]
console.error('skill — stub. issue #17 wires the real commands.')
if (cmd) console.error(`requested: ${cmd}`)
process.exit(cmd ? 0 : 1)
