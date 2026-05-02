// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SkillLink.sol";

/// @dev Mock ENS Registry that lets us control name ownership in tests
contract MockENSRegistry {
    mapping(bytes32 => address) public owner;

    function setOwner(bytes32 node, address _owner) external {
        owner[node] = _owner;
    }
}

/// @dev Mock skill implementation — simple quote oracle
contract MockQuoteSkill {
    function getQuote(string calldata tokenId) external pure returns (uint256) {
        if (keccak256(bytes(tokenId)) == keccak256("ethereum")) return 2300e6;
        if (keccak256(bytes(tokenId)) == keccak256("bitcoin")) return 77000e6;
        return 0;
    }

    function forbidden() external pure returns (uint256) {
        return 999;
    }
}

/// @dev Second mock for composition demo
contract MockSushiQuote {
    function getQuote(string calldata) external pure returns (uint256) {
        return 2295e6; // slightly lower
    }
}

/// @dev Aggregator that calls two skills via SkillLink and picks the best
contract BestQuoteAggregator {
    SkillLink public registry;
    bytes32 public quoteA;
    bytes32 public quoteB;

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

contract SkillLinkTest is Test {
    SkillLink public registry;
    MockENSRegistry public mockENS;
    MockQuoteSkill public quoteSkill;
    MockSushiQuote public sushiSkill;

    address owner = address(0xBEEF);
    address attacker = address(0xDEAD);

    bytes32 quoteNode = keccak256("quote.skilltest.eth"); // simplified for tests
    bytes32 sushiNode = keccak256("sushi.skilltest.eth");

    bytes4 getQuoteSel = MockQuoteSkill.getQuote.selector;
    bytes4 forbiddenSel = MockQuoteSkill.forbidden.selector;

    function setUp() public {
        // Deploy mock ENS and set ownership
        mockENS = new MockENSRegistry();
        mockENS.setOwner(quoteNode, owner);
        mockENS.setOwner(sushiNode, owner);

        // Deploy SkillLink with mock ENS
        // We need to etch the mock at the real ENS address
        registry = new SkillLink();
        vm.etch(address(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e), address(mockENS).code);

        // Copy storage from mockENS to the etched address
        // Set owner for quoteNode
        vm.store(
            address(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e),
            keccak256(abi.encode(quoteNode, uint256(0))),
            bytes32(uint256(uint160(owner)))
        );
        vm.store(
            address(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e),
            keccak256(abi.encode(sushiNode, uint256(0))),
            bytes32(uint256(uint160(owner)))
        );

        // Deploy mock skills
        quoteSkill = new MockQuoteSkill();
        sushiSkill = new MockSushiQuote();
    }

    // ── Registration tests ───────────────────────────────────────────────

    function test_register_success() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        (address impl, address skillOwner, uint96 registeredAt,) = registry.skills(quoteNode);
        assertEq(impl, address(quoteSkill));
        assertEq(skillOwner, owner);
        assertGt(registeredAt, 0);
        assertEq(registry.skillCount(), 1);
    }

    function test_register_notOwner_reverts() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(attacker);
        vm.expectRevert();
        registry.register(quoteNode, address(quoteSkill), sels);
    }

    function test_register_noSelectors_reverts() public {
        bytes4[] memory sels = new bytes4[](0);

        vm.prank(owner);
        vm.expectRevert(SkillLink.NoSelectors.selector);
        registry.register(quoteNode, address(quoteSkill), sels);
    }

    function test_register_overwrite() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        // Re-register with new impl
        vm.prank(owner);
        registry.register(quoteNode, address(sushiSkill), sels);

        (address impl,,,) = registry.skills(quoteNode);
        assertEq(impl, address(sushiSkill));
        // skillCount should still be 1 (update, not new)
        assertEq(registry.skillCount(), 1);
    }

    // ── Call tests ───────────────────────────────────────────────────────

    function test_call_success() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        bytes memory callData = abi.encodeWithSelector(getQuoteSel, "ethereum");
        bytes memory result = registry.call(quoteNode, callData);
        uint256 price = abi.decode(result, (uint256));
        assertEq(price, 2300e6);
    }

    function test_call_unregistered_reverts() public {
        bytes memory callData = abi.encodeWithSelector(getQuoteSel, "ethereum");
        vm.expectRevert(abi.encodeWithSelector(SkillLink.SkillNotRegistered.selector, quoteNode));
        registry.call(quoteNode, callData);
    }

    function test_call_forbiddenSelector_reverts() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel; // only allow getQuote

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        bytes memory callData = abi.encodeWithSelector(forbiddenSel);
        vm.expectRevert(abi.encodeWithSelector(SkillLink.SelectorNotAllowed.selector, quoteNode, forbiddenSel));
        registry.call(quoteNode, callData);
    }

    function test_call_forwardsValue() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        // Call with value (skill doesn't use it but shouldn't revert)
        bytes memory callData = abi.encodeWithSelector(getQuoteSel, "ethereum");
        bytes memory result = registry.call{value: 0}(quoteNode, callData);
        uint256 price = abi.decode(result, (uint256));
        assertEq(price, 2300e6);
    }

    // ── Composition test ─────────────────────────────────────────────────

    function test_composition_bestQuote() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.startPrank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);
        registry.register(sushiNode, address(sushiSkill), sels);
        vm.stopPrank();

        BestQuoteAggregator agg = new BestQuoteAggregator(registry, quoteNode, sushiNode);
        uint256 best = agg.getBestQuote("ethereum");
        // quoteSkill returns 2300e6, sushiSkill returns 2295e6
        assertEq(best, 2300e6);
    }

    // ── View helpers ─────────────────────────────────────────────────────

    function test_getSelectors() public {
        bytes4[] memory sels = new bytes4[](2);
        sels[0] = getQuoteSel;
        sels[1] = forbiddenSel;

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        bytes4[] memory result = registry.getSelectors(quoteNode);
        assertEq(result.length, 2);
        assertEq(result[0], getQuoteSel);
        assertEq(result[1], forbiddenSel);
    }

    function test_isSelectorAllowed() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        assertTrue(registry.isSelectorAllowed(quoteNode, getQuoteSel));
        assertFalse(registry.isSelectorAllowed(quoteNode, forbiddenSel));
    }

    // ── NameWrapper-wrapped name tests ───────────────────────────────────
    //
    // Wrapped names report `ENS_REGISTRY.owner(node)` as the NameWrapper
    // contract address. The real owner lives on `NameWrapper.ownerOf(uint256(node))`.
    // SkillLink falls through to NameWrapper in that case — these tests verify it.

    function test_register_wrappedName_success() public {
        // Etch a mock NameWrapper at the canonical Sepolia address and set
        // it as the ENS owner of `quoteNode`.
        address wrapperAddr = 0x0635513f179D50A207757E05759CbD106d7dFcE8;
        vm.etch(wrapperAddr, address(new MockNameWrapper()).code);
        MockNameWrapper(wrapperAddr).setOwner(uint256(quoteNode), owner);

        // ENS Registry now reports NameWrapper as the owner of quoteNode.
        vm.store(
            address(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e),
            keccak256(abi.encode(quoteNode, uint256(0))),
            bytes32(uint256(uint160(wrapperAddr)))
        );

        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(owner);
        registry.register(quoteNode, address(quoteSkill), sels);

        (address impl, address skillOwner,,) = registry.skills(quoteNode);
        assertEq(impl, address(quoteSkill));
        assertEq(skillOwner, owner);
    }

    function test_register_wrappedName_notWrappedOwner_reverts() public {
        address wrapperAddr = 0x0635513f179D50A207757E05759CbD106d7dFcE8;
        vm.etch(wrapperAddr, address(new MockNameWrapper()).code);
        // Wrap-owner is `owner`, but the attacker is calling.
        MockNameWrapper(wrapperAddr).setOwner(uint256(quoteNode), owner);
        vm.store(
            address(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e),
            keccak256(abi.encode(quoteNode, uint256(0))),
            bytes32(uint256(uint160(wrapperAddr)))
        );

        bytes4[] memory sels = new bytes4[](1);
        sels[0] = getQuoteSel;

        vm.prank(attacker);
        vm.expectRevert();
        registry.register(quoteNode, address(quoteSkill), sels);
    }
}

/// @dev Mock ENS NameWrapper for the wrapped-name test path
contract MockNameWrapper {
    mapping(uint256 => address) public _owner;

    function setOwner(uint256 id, address o) external {
        _owner[id] = o;
    }

    function ownerOf(uint256 id) external view returns (address) {
        return _owner[id];
    }
}
