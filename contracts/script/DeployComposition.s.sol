// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/SkillLink.sol";
import "../src/examples/QuoteUniswap.sol";
import "../src/examples/QuoteSushi.sol";
import "../src/examples/BestQuoteAggregator.sol";

/// @title DeployComposition — bootstraps the on-chain skill composition demo
///
/// Deploys QuoteUniswap + QuoteSushi + BestQuoteAggregator, registers all three
/// in the existing SkillLink contract, and runs `getBestQuote("ethereum")` once
/// to capture the demo evidence.
///
/// Required env:
///   SEPOLIA_PRIVATE_KEY  — owner of the three .skilltest.eth subnames
///   SKILLLINK_ADDRESS    — already-deployed SkillLink (e.g. 0xE2532C…)
///
/// Optional env:
///   QUOTE_UNISWAP_ENS    — default "quote.uniswap.skilltest.eth"
///   QUOTE_SUSHI_ENS      — default "quote.sushi.skilltest.eth"
///   QUOTE_AGGREGATE_ENS  — default "quote.aggregate.skilltest.eth"
///
/// Run:
///   forge script script/DeployComposition.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
contract DeployComposition is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("SEPOLIA_PRIVATE_KEY");
        address skillLinkAddr = vm.envAddress("SKILLLINK_ADDRESS");

        string memory uniswapEns = _envOrDefault(
            "QUOTE_UNISWAP_ENS",
            "quote.uniswap.skilltest.eth"
        );
        string memory sushiEns = _envOrDefault(
            "QUOTE_SUSHI_ENS",
            "quote.sushi.skilltest.eth"
        );
        string memory aggregateEns = _envOrDefault(
            "QUOTE_AGGREGATE_ENS",
            "quote.aggregate.skilltest.eth"
        );

        bytes32 uniswapNode = _namehash(uniswapEns);
        bytes32 sushiNode = _namehash(sushiEns);
        bytes32 aggregateNode = _namehash(aggregateEns);

        SkillLink registry = SkillLink(skillLinkAddr);

        vm.startBroadcast(deployerKey);

        // 1. Deploy the two underlying quote skills
        QuoteUniswap uni = new QuoteUniswap();
        QuoteSushi sushi = new QuoteSushi();
        console.log("QuoteUniswap deployed at:", address(uni));
        console.log("QuoteSushi   deployed at:", address(sushi));

        // 2. Register both as ENS-named skills with `getQuote(string)` in the allowlist
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = QuoteUniswap.getQuote.selector;

        registry.register(uniswapNode, address(uni), sels);
        registry.register(sushiNode, address(sushi), sels);
        console.log("Registered quote.uniswap.skilltest.eth -> uni");
        console.log("Registered quote.sushi.skilltest.eth   -> sushi");

        // 3. Deploy the composition skill that calls both via the registry
        BestQuoteAggregator agg = new BestQuoteAggregator(
            registry,
            uniswapNode,
            sushiNode
        );
        console.log("BestQuoteAggregator deployed at:", address(agg));

        // 4. Register the aggregator as itself a skill — third-party callers can
        //    invoke `quote.aggregate.skilltest.eth` and the registry will dispatch
        //    to the aggregator, which in turn dispatches to the two underlying
        //    skills via the registry. Recursive composition.
        bytes4[] memory aggSels = new bytes4[](1);
        aggSels[0] = BestQuoteAggregator.getBestQuote.selector;
        registry.register(aggregateNode, address(agg), aggSels);
        console.log("Registered quote.aggregate.skilltest.eth -> agg");

        vm.stopBroadcast();

        // 5. Capture demo evidence — call the aggregator and log the result
        uint256 best = agg.getBestQuote("ethereum");
        console.log("Best quote for ethereum (USD, 6dp):", best);

        console.log("---");
        console.log("Demo command (anyone can run, no key needed):");
        console.log(
            "  cast call",
            skillLinkAddr,
            "'call(bytes32,bytes)(bytes)'"
        );
        console.log("    <namehash(quote.aggregate.skilltest.eth)>");
        console.log(
            "    $(cast calldata 'getBestQuote(string)' 'ethereum')"
        );
    }

    // ── ENS namehash (ENSIP-1) ───────────────────────────────────────────

    /// @dev Computes the ENS namehash of a dot-separated name, e.g.
    ///      `_namehash("foo.bar.eth")`.
    function _namehash(string memory name) internal pure returns (bytes32 node) {
        bytes memory raw = bytes(name);
        if (raw.length == 0) return bytes32(0);

        // Walk right-to-left, hashing each label into the rolling node.
        uint256 end = raw.length;
        uint256 cursor = raw.length;
        while (cursor > 0) {
            cursor--;
            if (raw[cursor] == 0x2e /* '.' */) {
                node = keccak256(
                    abi.encodePacked(node, keccak256(_slice(raw, cursor + 1, end)))
                );
                end = cursor;
            }
        }
        node = keccak256(
            abi.encodePacked(node, keccak256(_slice(raw, 0, end)))
        );
    }

    function _slice(bytes memory data, uint256 start, uint256 end)
        internal
        pure
        returns (bytes memory out)
    {
        out = new bytes(end - start);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = data[start + i];
        }
    }

    function _envOrDefault(string memory key, string memory fallback_)
        internal
        view
        returns (string memory)
    {
        try vm.envString(key) returns (string memory v) {
            return v;
        } catch {
            return fallback_;
        }
    }
}
