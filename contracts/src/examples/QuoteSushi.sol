// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuoteSushi — second reference skill (mock Sushiswap quote)
/// @notice Returns a slightly-different USD price for the same token ids
///         so the composition demo has something to choose between.
contract QuoteSushi {
    function getQuote(string calldata tokenId) external pure returns (uint256) {
        bytes32 h = keccak256(bytes(tokenId));
        if (h == keccak256("ethereum"))     return 2_295e6;  // 5 USD lower than Uniswap
        if (h == keccak256("bitcoin"))      return 77_050e6; // 50 USD higher
        if (h == keccak256("usd-coin"))     return 1e6;
        if (h == keccak256("wrapped-bitcoin")) return 76_900e6;
        return 0;
    }
}
