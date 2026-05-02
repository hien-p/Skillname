// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SkillNFT.sol";

/// @dev Mock the IdentityRegistry at the canonical Sepolia address so tests
///      run hermetically.
contract MockIdentityRegistry {
    mapping(uint256 => address) public _owner;
    function setOwner(uint256 id, address o) external { _owner[id] = o; }
    function ownerOf(uint256 id) external view returns (address) { return _owner[id]; }
}

contract SkillNFTTest is Test {
    SkillNFT nft;
    MockIdentityRegistry mockRegistry;

    address agentOwner = address(0xBEEF);
    address attacker   = address(0xDEAD);
    address transferTarget = address(0xC0DE);

    bytes32 quoteNode = keccak256("quote.skilltest.eth"); // simplified, fine for unit tests
    uint256 agentId = 7;
    string  uriV1 = "0g://0x5d27a5c2b10d86f258195078562cae80ae83c39f9d27d82bd3a5f047e1e997a2";
    string  uriV2 = "0g://0xa70c88dc726a53ec6a06c2637f104f1b39358965ed6065d791fd49483c4b4687";

    function setUp() public {
        nft = new SkillNFT();

        // Etch a mock IdentityRegistry at the canonical Sepolia address +
        // populate storage so SkillNFT's constant address resolves to it.
        address regAddr = 0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4;
        vm.etch(regAddr, address(new MockIdentityRegistry()).code);
        // Set owner of agentId 7 → agentOwner
        vm.store(
            regAddr,
            keccak256(abi.encode(agentId, uint256(0))),
            bytes32(uint256(uint160(agentOwner)))
        );
    }

    // ── mint ─────────────────────────────────────────────────────────────

    function test_mint_success() public {
        vm.prank(agentOwner);
        uint256 id = nft.mintAgent(quoteNode, agentId, uriV1);

        assertEq(id, 1);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.ownerOf(id), agentOwner);
        assertEq(nft.balanceOf(agentOwner), 1);
        assertEq(nft.tokenURI(id), uriV1);

        (bytes32 ensNode, uint256 storedAgentId, string memory uri, address minter, uint64 mintedAt) =
            nft.agents(id);
        assertEq(ensNode, quoteNode);
        assertEq(storedAgentId, agentId);
        assertEq(uri, uriV1);
        assertEq(minter, agentOwner);
        assertGt(mintedAt, 0);
    }

    function test_mint_notAgentOwner_reverts() public {
        vm.prank(attacker);
        vm.expectRevert();
        nft.mintAgent(quoteNode, agentId, uriV1);
    }

    function test_mint_assignsIncrementingTokenIds() public {
        vm.prank(agentOwner);
        uint256 a = nft.mintAgent(quoteNode, agentId, uriV1);
        vm.prank(agentOwner);
        uint256 b = nft.mintAgent(quoteNode, agentId, uriV2);
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(nft.totalSupply(), 2);
    }

    // ── metadata ─────────────────────────────────────────────────────────

    function test_setMetadataUri_owner() public {
        vm.prank(agentOwner);
        uint256 id = nft.mintAgent(quoteNode, agentId, uriV1);

        vm.prank(agentOwner);
        nft.setMetadataUri(id, uriV2);
        assertEq(nft.tokenURI(id), uriV2);
    }

    function test_setMetadataUri_notOwner_reverts() public {
        vm.prank(agentOwner);
        uint256 id = nft.mintAgent(quoteNode, agentId, uriV1);

        vm.prank(attacker);
        vm.expectRevert();
        nft.setMetadataUri(id, uriV2);
    }

    // ── transfer ─────────────────────────────────────────────────────────

    function test_transfer() public {
        vm.prank(agentOwner);
        uint256 id = nft.mintAgent(quoteNode, agentId, uriV1);

        vm.prank(agentOwner);
        nft.transferFrom(agentOwner, transferTarget, id);

        assertEq(nft.ownerOf(id), transferTarget);
        assertEq(nft.balanceOf(agentOwner), 0);
        assertEq(nft.balanceOf(transferTarget), 1);
    }

    function test_transfer_notOwner_reverts() public {
        vm.prank(agentOwner);
        uint256 id = nft.mintAgent(quoteNode, agentId, uriV1);

        vm.prank(attacker);
        vm.expectRevert();
        nft.transferFrom(agentOwner, transferTarget, id);
    }

    function test_approveAndTransferFrom() public {
        vm.prank(agentOwner);
        uint256 id = nft.mintAgent(quoteNode, agentId, uriV1);

        vm.prank(agentOwner);
        nft.approve(attacker, id);
        assertEq(nft.getApproved(id), attacker);

        // Even attacker can transferFrom because they have approval
        vm.prank(attacker);
        nft.transferFrom(agentOwner, transferTarget, id);
        assertEq(nft.ownerOf(id), transferTarget);
        // Approval should clear after transfer
        assertEq(nft.getApproved(id), address(0));
    }

    // ── ERC-165 ──────────────────────────────────────────────────────────

    function test_supportsInterface() public {
        assertTrue(nft.supportsInterface(0x01ffc9a7), "ERC-165");
        assertTrue(nft.supportsInterface(0x80ac58cd), "ERC-721");
        assertTrue(nft.supportsInterface(0x5b5e139f), "ERC-721 Metadata");
        assertFalse(nft.supportsInterface(0xffffffff));
    }

    // ── ERC-721 metadata getters ─────────────────────────────────────────

    function test_metadataNameSymbol() public {
        assertEq(nft.name(), "Skillname Agent");
        assertEq(nft.symbol(), "SKILL");
    }

    function test_tokenURI_nonexistent_reverts() public {
        vm.expectRevert();
        nft.tokenURI(999);
    }
}
