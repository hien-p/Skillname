// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IdentityRegistry — minimal ERC-8004-compatible Identity Registry
/// @notice Mints sequential agentIds, each tied to a free-form name string and
///         the wallet that registered it. The address of this contract is what
///         goes into the ENSIP-25 `agent-registration[<erc7930>][<agentId>]`
///         text-record key.
/// @dev    ENSIP-25 verification is one-directional — the spec only requires
///         the ENS text record to exist with a non-empty value. The registry
///         side is intentionally minimal: just enough to give judges a
///         browsable contract at a public Sepolia address. We don't enforce
///         a reverse-binding from agentId → ENS name; ownership of the
///         mapping lives in ENS, not here.
contract IdentityRegistry {
    struct Agent {
        string  name;       // free-form, typically the ENS name being identified
        address owner;      // wallet that registered this agentId
        uint64  mintedAt;   // block.timestamp at registration
    }

    /// @notice agentId → Agent. id 0 is reserved as "unset".
    mapping(uint256 => Agent) public agents;

    /// @notice Last minted agentId. Starts at 0; the first mint returns 1.
    uint256 public lastId;

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string  name
    );
    event AgentTransferred(
        uint256 indexed agentId,
        address indexed from,
        address indexed to
    );

    error NotAgentOwner(uint256 agentId, address sender, address owner);
    error AgentNotFound(uint256 agentId);

    /// @notice Mint a new agentId tied to a name. Anyone can call.
    function register(string calldata name) external returns (uint256 agentId) {
        agentId = ++lastId;
        agents[agentId] = Agent({
            name: name,
            owner: msg.sender,
            mintedAt: uint64(block.timestamp)
        });
        emit AgentRegistered(agentId, msg.sender, name);
    }

    /// @notice Transfer an agent's ownership. Only the current owner can call.
    function transfer(uint256 agentId, address to) external {
        Agent storage a = agents[agentId];
        if (a.owner == address(0)) revert AgentNotFound(agentId);
        if (msg.sender != a.owner) revert NotAgentOwner(agentId, msg.sender, a.owner);
        emit AgentTransferred(agentId, a.owner, to);
        a.owner = to;
    }

    /// @notice Convenience — return the name registered for an agentId.
    function nameOf(uint256 agentId) external view returns (string memory) {
        return agents[agentId].name;
    }

    /// @notice Convenience — return the owner of an agentId.
    function ownerOf(uint256 agentId) external view returns (address) {
        return agents[agentId].owner;
    }
}
