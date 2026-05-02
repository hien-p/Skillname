// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SkillNFT — ERC-721 wrapper for ENS-named skills (ERC-7857 sketch)
/// @notice Each token represents ownership of a registered skill, identified
///         by its ENS namehash + IdentityRegistry agentId. Transferring the
///         NFT transfers economic rights (e.g. future x402 settlement splits)
///         without affecting the underlying ENS ownership — the two
///         identities are bound on-chain via this contract's storage.
///
///         This is a minimal scaffold for the 0G iNFT track + ENS Most
///         Creative track. Splitter integration (% of x402 → token holder)
///         and ERC-6551 token-bound accounts are intentionally deferred to
///         keep the surface auditable for the hackathon submission.
///
/// @dev    Implemented from scratch (no OpenZeppelin dep) to keep the
///         contracts/ tree dependency-free. Covers ERC-721 + ERC-721Metadata
///         + ERC-165 — the minimum for marketplaces (OpenSea testnet) to
///         recognise the collection.

interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
}

contract SkillNFT {
    // ── Constants ────────────────────────────────────────────────────────

    string public constant name   = "Skillname Agent";
    string public constant symbol = "SKILL";

    /// @notice IdentityRegistry on Sepolia (per docs/ENSIP25_BINDING.md)
    IIdentityRegistry public constant IDENTITY_REGISTRY =
        IIdentityRegistry(0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4);

    // ── Types ────────────────────────────────────────────────────────────

    struct Agent {
        bytes32 ensNode;       // namehash of the ENS name this token wraps
        uint256 agentId;       // IdentityRegistry agentId at mint time
        string  metadataUri;   // pointer to JSON metadata (typically 0g:// or ipfs://)
        address minter;        // address that called mint()
        uint64  mintedAt;      // block.timestamp
    }

    // ── State ────────────────────────────────────────────────────────────

    uint256 public totalSupply;
    mapping(uint256 => Agent) public agents;        // tokenId → Agent
    mapping(uint256 => address) private _owners;    // tokenId → owner
    mapping(address => uint256) private _balances;  // owner → balance
    mapping(uint256 => address) private _approved;  // tokenId → approved
    mapping(address => mapping(address => bool)) private _operators;

    // ── Events ───────────────────────────────────────────────────────────

    /// @notice ERC-721
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    /// @notice Skillname-specific — when a new agent is minted.
    event AgentMinted(
        uint256 indexed tokenId,
        bytes32 indexed ensNode,
        uint256 indexed agentId,
        address minter,
        string  metadataUri
    );

    /// @notice Lets metadata indexers (OpenSea, etc.) refresh per-token data.
    event MetadataUpdate(uint256 indexed tokenId);

    // ── Errors ───────────────────────────────────────────────────────────

    error AgentIdNotOwnedByMinter(uint256 agentId, address minter, address registryOwner);
    error TokenDoesNotExist(uint256 tokenId);
    error NotAuthorized(address caller);
    error TransferToZero();
    error NotCurrentOwner(address from, address actualOwner);
    error InvalidRecipient();

    // ── Mint ─────────────────────────────────────────────────────────────

    /// @notice Mint a new skill NFT. Caller must be the IdentityRegistry
    ///         owner of `agentId` so the binding is meaningful.
    /// @param  ensNode      namehash of the ENS name this token represents
    /// @param  agentId      IdentityRegistry agentId previously minted to caller
    /// @param  metadataUri  JSON metadata URI (0g:// or ipfs://); should resolve
    ///                      to an OpenSea-compatible JSON document.
    function mintAgent(
        bytes32 ensNode,
        uint256 agentId,
        string calldata metadataUri
    ) external returns (uint256 tokenId) {
        // Verify msg.sender owns this agentId on the registry
        address registryOwner = IDENTITY_REGISTRY.ownerOf(agentId);
        if (registryOwner != msg.sender) {
            revert AgentIdNotOwnedByMinter(agentId, msg.sender, registryOwner);
        }

        unchecked {
            tokenId = ++totalSupply;
        }
        agents[tokenId] = Agent({
            ensNode: ensNode,
            agentId: agentId,
            metadataUri: metadataUri,
            minter: msg.sender,
            mintedAt: uint64(block.timestamp)
        });
        _owners[tokenId] = msg.sender;
        unchecked { _balances[msg.sender]++; }

        emit Transfer(address(0), msg.sender, tokenId);
        emit AgentMinted(tokenId, ensNode, agentId, msg.sender, metadataUri);
    }

    /// @notice Update the metadata URI for a token. Only the current owner.
    function setMetadataUri(uint256 tokenId, string calldata uri) external {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert TokenDoesNotExist(tokenId);
        if (msg.sender != owner) revert NotAuthorized(msg.sender);
        agents[tokenId].metadataUri = uri;
        emit MetadataUpdate(tokenId);
    }

    // ── ERC-721 core ─────────────────────────────────────────────────────

    function ownerOf(uint256 tokenId) public view returns (address) {
        address o = _owners[tokenId];
        if (o == address(0)) revert TokenDoesNotExist(tokenId);
        return o;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist(tokenId);
        return agents[tokenId].metadataUri;
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operators[owner][msg.sender]) {
            revert NotAuthorized(msg.sender);
        }
        _approved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist(tokenId);
        return _approved[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
        // Recipient onERC721Received check intentionally omitted — keeping the
        // contract minimal. EOAs and standard wallets handle this fine; integrators
        // that need full ERC-721 receiver semantics should call transferFrom.
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata /*data*/
    ) external {
        _transfer(from, to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        if (to == address(0)) revert TransferToZero();
        address owner = _owners[tokenId];
        if (owner == address(0)) revert TokenDoesNotExist(tokenId);
        if (owner != from) revert NotCurrentOwner(from, owner);

        bool authorized =
            msg.sender == owner ||
            _operators[owner][msg.sender] ||
            _approved[tokenId] == msg.sender;
        if (!authorized) revert NotAuthorized(msg.sender);

        delete _approved[tokenId];
        unchecked {
            _balances[from]--;
            _balances[to]++;
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    // ── ERC-165 ──────────────────────────────────────────────────────────

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return
            id == 0x01ffc9a7 || // ERC-165
            id == 0x80ac58cd || // ERC-721
            id == 0x5b5e139f;   // ERC-721 Metadata
    }
}
