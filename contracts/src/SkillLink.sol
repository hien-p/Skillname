// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SkillLink — ENS-keyed on-chain skill registry
/// @notice Maps ENS namehash → implementation contract. Any contract or EOA
///         can invoke a registered skill by its ENS name. Ownership is verified
///         via ENS Registry at register time — only the ENS name owner can
///         register or update a skill's implementation.
/// @dev    Events are shaped to feed the analytics indexer (#15) directly.

interface IENS {
    function owner(bytes32 node) external view returns (address);
}

contract SkillLink {
    // ── Types ────────────────────────────────────────────────────────────

    struct Skill {
        address impl;           // implementation contract to delegatecall/call
        address owner;          // ENS name owner at registration time
        uint96  registeredAt;   // block.timestamp
        uint256 selectorBitmap; // packed bitmap of allowed selectors (first 256 slots)
        bytes4[] selectors;     // full selector list for enumeration
    }

    // ── State ────────────────────────────────────────────────────────────

    /// @notice ENS Registry on Sepolia (same address on all EVM chains)
    IENS public constant ENS_REGISTRY = IENS(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e);

    /// @notice namehash → registered skill
    mapping(bytes32 => Skill) public skills;

    /// @notice Total number of registered skills
    uint256 public skillCount;

    // ── Events ───────────────────────────────────────────────────────────

    event SkillRegistered(
        bytes32 indexed node,
        address indexed impl,
        address indexed owner,
        bytes4[] selectors
    );

    event SkillCalled(
        bytes32 indexed node,
        address indexed sender,
        bytes4  indexed selector,
        bool    success,
        uint256 gasUsed
    );

    // ── Errors ───────────────────────────────────────────────────────────

    error NotENSOwner(bytes32 node, address sender, address owner);
    error SkillNotRegistered(bytes32 node);
    error SelectorNotAllowed(bytes32 node, bytes4 selector);
    error CallFailed(bytes returnData);
    error NoSelectors();

    // ── Registration ─────────────────────────────────────────────────────

    /// @notice Register or update a skill implementation for an ENS name.
    ///         Only the current ENS name owner can call this.
    /// @param node       namehash of the ENS name (e.g. namehash("quote.skilltest.eth"))
    /// @param impl       address of the implementation contract
    /// @param selectors_ function selectors the registry will forward
    function register(
        bytes32 node,
        address impl,
        bytes4[] calldata selectors_
    ) external {
        if (selectors_.length == 0) revert NoSelectors();

        // Verify caller owns the ENS name
        address ensOwner = ENS_REGISTRY.owner(node);
        if (msg.sender != ensOwner) {
            revert NotENSOwner(node, msg.sender, ensOwner);
        }

        // Build selector bitmap for O(1) lookup
        uint256 bitmap;
        for (uint256 i; i < selectors_.length; i++) {
            uint256 slot = uint256(uint32(selectors_[i])) & 0xFF;
            bitmap |= (1 << slot);
        }

        // Track new vs update
        if (skills[node].impl == address(0)) {
            skillCount++;
        }

        skills[node] = Skill({
            impl: impl,
            owner: msg.sender,
            registeredAt: uint96(block.timestamp),
            selectorBitmap: bitmap,
            selectors: selectors_
        });

        emit SkillRegistered(node, impl, msg.sender, selectors_);
    }

    // ── Invocation ───────────────────────────────────────────────────────

    /// @notice Call a registered skill by ENS namehash.
    ///         Forwards msg.value and returns the call result.
    /// @param node ENS namehash of the skill
    /// @param data ABI-encoded function call (selector + args)
    /// @return result The return data from the skill implementation
    function call(bytes32 node, bytes calldata data)
        external
        payable
        returns (bytes memory result)
    {
        Skill storage skill = skills[node];
        if (skill.impl == address(0)) revert SkillNotRegistered(node);

        // Check selector is in the allowlist
        bytes4 selector = bytes4(data[:4]);
        if (!_isSelectorAllowed(skill, selector)) {
            revert SelectorNotAllowed(node, selector);
        }

        // Forward the call
        uint256 gasBefore = gasleft();
        bool success;
        (success, result) = skill.impl.call{value: msg.value}(data);
        uint256 gasUsed = gasBefore - gasleft();

        emit SkillCalled(node, msg.sender, selector, success, gasUsed);

        if (!success) revert CallFailed(result);
    }

    // ── View helpers ─────────────────────────────────────────────────────

    /// @notice Get the selectors registered for a skill
    function getSelectors(bytes32 node) external view returns (bytes4[] memory) {
        return skills[node].selectors;
    }

    /// @notice Check if a selector is allowed for a skill
    function isSelectorAllowed(bytes32 node, bytes4 selector) external view returns (bool) {
        return _isSelectorAllowed(skills[node], selector);
    }

    // ── Internal ─────────────────────────────────────────────────────────

    function _isSelectorAllowed(Skill storage skill, bytes4 selector) internal view returns (bool) {
        // Fast path: bitmap check
        uint256 slot = uint256(uint32(selector)) & 0xFF;
        if (skill.selectorBitmap & (1 << slot) == 0) return false;

        // Bitmap can have false positives (collision on lower 8 bits).
        // Full check against the selector array.
        for (uint256 i; i < skill.selectors.length; i++) {
            if (skill.selectors[i] == selector) return true;
        }
        return false;
    }
}
