// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuoteUniswap — reference skill implementation (mock Uniswap quote)
/// @notice Returns a hardcoded USD price for a CoinGecko-style token id.
///         Wired as the impl for `quote.uniswap.skilltest.eth` in the
///         SkillLink registry composition demo.
contract QuoteUniswap {
    function getQuote(string calldata tokenId) external pure returns (uint256) {
        bytes32 h = keccak256(bytes(tokenId));
        if (h == keccak256("ethereum"))     return 2_300e6;
        if (h == keccak256("bitcoin"))      return 77_000e6;
        if (h == keccak256("usd-coin"))     return 1e6;
        if (h == keccak256("wrapped-bitcoin")) return 76_950e6;
        return 0;
    }
}
