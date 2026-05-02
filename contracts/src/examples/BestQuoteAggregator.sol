// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../SkillLink.sol";

/// @title BestQuoteAggregator — composition skill that calls two skills via SkillLink
/// @notice Demonstrates on-chain skill composition: this contract is itself a
///         registered skill (`quote.aggregate.skilltest.eth`) whose function
///         dispatches to two other registered skills (`quote.uniswap.skilltest.eth`,
///         `quote.sushi.skilltest.eth`) through the SkillLink registry, then
///         picks the higher quote. No direct addresses are hardcoded — all
///         routing happens by ENS namehash.
contract BestQuoteAggregator {
    SkillLink public immutable registry;
    bytes32 public immutable quoteA;
    bytes32 public immutable quoteB;

    constructor(SkillLink _registry, bytes32 _quoteA, bytes32 _quoteB) {
        registry = _registry;
        quoteA = _quoteA;
        quoteB = _quoteB;
    }

    function getBestQuote(string calldata tokenId) external returns (uint256) {
        bytes memory callData = abi.encodeWithSignature("getQuote(string)", tokenId);
        bytes memory resultA = registry.call(quoteA, callData);
        bytes memory resultB = registry.call(quoteB, callData);
        uint256 a = abi.decode(resultA, (uint256));
        uint256 b = abi.decode(resultB, (uint256));
        return a > b ? a : b;
    }
}
