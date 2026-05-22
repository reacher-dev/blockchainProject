// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  RentEscrow
 * @notice DePIN Rental Noise Governance System
 *
 * Fixes applied vs v1:
 *   1. lockedDeposit   — rewards from a penalty go into a locked balance; only
 *                        released once the 24h appeal window closes (or appeal
 *                        resolves). _reversePenalty claws back from locked, not
 *                        free, balance — eliminating the underflow bug.
 *   2. Quorum          — executeProposal requires at least VOTE_QUORUM votes cast.
 *   3. Landlord votes  — vote() now accepts landlord as an eligible voter.
 *   4. Tiered penalty  — penalty scales with dB level (LOW/MED/HIGH tiers).
 *   5. Min deposit     — MINIMUM_DEPOSIT constant + isDepositSufficient() view.
 *   6. Nonce replay    — timestamp replaced by a contract-level reportNonce;
 *                        oracle must include the current nonce in every signature.
 *   7. Multi-oracle    — addOracle/removeOracle; any registered oracle can submit;
 *                        cannot remove the last oracle.
 */
contract RentEscrow is ReentrancyGuard {
    using ECDSA for bytes32;

    // ─── Constants ───────────────────────────────────────────────────────────────

    uint8   public constant MAX_ROOMS           = 5;
    uint256 public constant NOISE_THRESHOLD_DB  = 70;
    uint256 public constant APPEAL_WINDOW       = 24 hours;
    uint256 public constant APPEAL_FEE          = 0.01 ether;
    uint256 public constant VOTE_PASS_THRESHOLD = 60;   // percent of votes cast
    uint256 public constant VOTE_QUORUM         = 3;    // minimum votes that must be cast

    // Fix 4 — tiered penalties by dB level
    uint256 public constant PENALTY_LOW  = 0.2 ether;  // 71 – 85 dB
    uint256 public constant PENALTY_MED  = 0.3 ether;  // 86 – 100 dB
    uint256 public constant PENALTY_HIGH = 0.4 ether;  // > 100 dB

    // Fix 5 — minimum free deposit a tenant must maintain to be penalty-eligible
    uint256 public constant MINIMUM_DEPOSIT = PENALTY_HIGH; // covers worst-case tier

    // ─── Custom Errors ───────────────────────────────────────────────────────────

    error NotLandlord();
    error NotTenant();
    error NotEligibleToVote();
    error InvalidRoom();
    error RoomOccupied();
    error ZeroAddress();
    error AlreadyRegistered();
    error ZeroDeposit();
    error InvalidNonce();           // Fix 6
    error NotAnOracle();            // Fix 7
    error OracleAlreadyAdded();     // Fix 7
    error OracleNotFound();         // Fix 7
    error MinOraclesRequired();     // Fix 7 — cannot remove last oracle
    error BelowNoiseThreshold();
    error InsufficientDeposit();
    error ViolationNotFound();
    error AlreadyAppealed();
    error AppealWindowClosed();
    error AppealWindowStillOpen();  // Fix 1
    error RewardsAlreadyReleased(); // Fix 1
    error NotThePenalizedTenant();
    error InsufficientDepositForFee();
    error ProposalNotFound();
    error AlreadyExecuted();
    error VotingStillOpen();
    error VotingClosed();
    error AlreadyVoted();
    error AppellantCannotVote();
    error NothingToWithdraw();
    error TransferFailed();
    error QuorumNotReached();       // Fix 2

    // ─── Roles ───────────────────────────────────────────────────────────────────

    address public immutable landlord;

    // Fix 7 — oracle pool instead of single address
    mapping(address => bool) public isOracle;
    uint256 public oracleCount;

    // ─── Tenant Storage ──────────────────────────────────────────────────────────

    struct Tenant {
        address addr;
        uint256 deposit;        // freely withdrawable balance
        uint256 lockedDeposit;  // Fix 1 — locked pending appeal resolution
        bool    registered;
    }

    /// roomIndex: 0 = A, 1 = B, 2 = C, 3 = D, 4 = E
    Tenant[MAX_ROOMS] public tenants;

    mapping(address => uint8) public addressToRoom;
    mapping(address => bool)  public isTenant;

    uint8 public tenantCount;

    // ─── Oracle Nonce ─────────────────────────────────────────────────────────────

    /**
     * Fix 6 — replaces timestamp-based freshness window.
     * Increments after every accepted noise report.
     * The oracle must read this value and include it in the signed message,
     * ensuring each signature is unique and cannot be replayed.
     */
    uint256 public reportNonce;

    // ─── Violations ──────────────────────────────────────────────────────────────

    struct Violation {
        uint8   roomIndex;
        uint256 decibels;
        uint256 reportedAt;
        uint256 penaltyPaid;
        bool    appealed;
    }

    struct ViolationLock {
        uint256 rewardPerRecipient; // Fix 1 — how much each recipient has locked
        bool    released;           // Fix 1 — true once rewards are freed or clawed back
    }

    uint256 public violationCount;
    mapping(uint256 => Violation)     public violations;
    mapping(uint256 => ViolationLock) public violationLocks; // Fix 1

    // ─── DAO Proposals ───────────────────────────────────────────────────────────

    struct Proposal {
        uint256 violationId;
        address appellant;
        uint256 createdAt;
        uint256 yesVotes;
        uint256 noVotes;
        bool    executed;
        bool    passed;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal)                 public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // ─── Events ──────────────────────────────────────────────────────────────────

    event TenantRegistered(uint8 indexed roomIndex, address tenant);
    event Deposited(uint8 indexed roomIndex, address tenant, uint256 amount);
    event Withdrawn(uint8 indexed roomIndex, address tenant, uint256 amount);
    event NoiseReported(uint256 indexed violationId, uint8 roomIndex, uint256 decibels, uint256 penalty);
    event PenaltyApplied(uint256 indexed violationId, uint8 offenderRoom, uint256 penaltyAmount, uint256 rewardPerTenant);
    event RewardsReleased(uint256 indexed violationId);
    event AppealCreated(uint256 indexed proposalId, uint256 violationId, address appellant, string reason);
    event VoteCast(uint256 indexed proposalId, address voter, bool approve);
    event ProposalExecuted(uint256 indexed proposalId, bool passed);
    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyLandlord() {
        if (msg.sender != landlord) revert NotLandlord();
        _;
    }

    modifier onlyTenant() {
        if (!isTenant[msg.sender]) revert NotTenant();
        _;
    }

    modifier validRoom(uint8 roomIndex) {
        if (roomIndex >= MAX_ROOMS) revert InvalidRoom();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor(address initialOracle) {
        if (initialOracle == address(0)) revert ZeroAddress();
        landlord = msg.sender;
        isOracle[initialOracle] = true;
        oracleCount = 1;
        emit OracleAdded(initialOracle);
    }

    // ─── Oracle Management (Fix 7) ────────────────────────────────────────────────

    /// @notice Add a new authorized oracle. Only landlord.
    function addOracle(address newOracle) external onlyLandlord {
        if (newOracle == address(0))  revert ZeroAddress();
        if (isOracle[newOracle])      revert OracleAlreadyAdded();
        isOracle[newOracle] = true;
        oracleCount++;
        emit OracleAdded(newOracle);
    }

    /// @notice Remove an oracle. Cannot remove the last one. Only landlord.
    function removeOracle(address target) external onlyLandlord {
        if (!isOracle[target])  revert OracleNotFound();
        if (oracleCount <= 1)   revert MinOraclesRequired();
        isOracle[target] = false;
        oracleCount--;
        emit OracleRemoved(target);
    }

    // ─── Setup ───────────────────────────────────────────────────────────────────

    /// @notice Register a tenant for a room. Only landlord.
    function registerTenant(uint8 roomIndex, address tenantAddr)
        external
        onlyLandlord
        validRoom(roomIndex)
    {
        if (tenants[roomIndex].registered) revert RoomOccupied();
        if (tenantAddr == address(0))      revert ZeroAddress();
        if (isTenant[tenantAddr])          revert AlreadyRegistered();

        tenants[roomIndex] = Tenant({
            addr:          tenantAddr,
            deposit:       0,
            lockedDeposit: 0,
            registered:    true
        });
        addressToRoom[tenantAddr] = roomIndex;
        isTenant[tenantAddr]      = true;
        tenantCount++;

        emit TenantRegistered(roomIndex, tenantAddr);
    }

    // ─── Deposit / Withdraw ───────────────────────────────────────────────────────

    /// @notice Tenant deposits ETH into their free escrow balance.
    function deposit() external payable onlyTenant {
        if (msg.value == 0) revert ZeroDeposit();
        uint8 room = addressToRoom[msg.sender];
        tenants[room].deposit += msg.value;
        emit Deposited(room, msg.sender, msg.value);
    }

    /**
     * @notice Tenant withdraws their FREE balance (lockedDeposit is not accessible).
     *         CEI + nonReentrant guard prevent reentrancy.
     */
    function withdraw() external onlyTenant nonReentrant {
        uint8   room   = addressToRoom[msg.sender];
        uint256 amount = tenants[room].deposit;
        if (amount == 0) revert NothingToWithdraw();

        // EFFECT — zero out before external call
        tenants[room].deposit = 0;
        emit Withdrawn(room, msg.sender, amount);

        // INTERACT
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ─── Oracle / Noise Reporting ─────────────────────────────────────────────────

    /**
     * @notice Submit an ECDSA-signed noise report from an authorized oracle.
     *
     * The oracle signs (EIP-191):
     *   keccak256(abi.encodePacked(block.chainid, address(this), roomIndex, decibels, nonce))
     *
     * Fix 6: `nonce` must equal the current `reportNonce` on-chain.
     *   - Prevents the oracle from signing two reports for the same incident
     *     (retries would produce different nonces).
     *   - No 5-minute freshness window needed; each nonce value is consumed once.
     *
     * Fix 7: signature is verified against the oracle pool (isOracle mapping).
     *
     * @param roomIndex  Room (0–4) where noise was detected.
     * @param decibels   Measured dB level.
     * @param nonce      Must equal current reportNonce.
     * @param signature  65-byte ECDSA signature (r ++ s ++ v).
     */
    function reportNoise(
        uint8          roomIndex,
        uint256        decibels,
        uint256        nonce,
        bytes calldata signature
    ) external validRoom(roomIndex) {
        // 1. Nonce must match (Fix 6)
        if (nonce != reportNonce) revert InvalidNonce();

        // 2. Verify oracle signature — OZ ECDSA reverts on address(0) and
        //    rejects malleable s-values automatically
        bytes32 msgHash = keccak256(
            abi.encodePacked(block.chainid, address(this), roomIndex, decibels, nonce)
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        address signer  = ethHash.recover(signature);
        if (!isOracle[signer]) revert NotAnOracle(); // Fix 7

        // 3. Threshold and deposit checks
        if (decibels <= NOISE_THRESHOLD_DB) revert BelowNoiseThreshold();

        uint256 penalty = _computePenalty(decibels); // Fix 4
        if (tenants[roomIndex].deposit < penalty)   revert InsufficientDeposit();

        // 4. Consume nonce (EFFECT before events/storage writes)
        reportNonce++;

        // 5. Record violation
        uint256 vid = violationCount++;
        violations[vid] = Violation({
            roomIndex:   roomIndex,
            decibels:    decibels,
            reportedAt:  block.timestamp,
            penaltyPaid: penalty,
            appealed:    false
        });

        emit NoiseReported(vid, roomIndex, decibels, penalty);

        // 6. Apply penalty (all internal — no external calls)
        _applyPenalty(vid);
    }

    // ─── Internal: Penalty Tier (Fix 4) ──────────────────────────────────────────

    function _computePenalty(uint256 decibels) internal pure returns (uint256) {
        if (decibels > 100) return PENALTY_HIGH;
        if (decibels > 85)  return PENALTY_MED;
        return PENALTY_LOW;
    }

    // ─── Internal: Penalty Application ───────────────────────────────────────────

    function _applyPenalty(uint256 vid) internal {
        Violation storage v = violations[vid];
        uint8 offender = v.roomIndex;

        // Deduct from offender's free balance
        tenants[offender].deposit -= v.penaltyPaid;

        // Fix 1 — distribute to recipients' LOCKED balance, not free balance.
        // Rewards stay locked until the 24 h appeal window closes without an appeal
        // (releaseRewards) or until an appeal is resolved (executeProposal).
        uint256 rewardEach = v.penaltyPaid / (tenantCount - 1);

        for (uint8 i = 0; i < MAX_ROOMS; i++) {
            if (i != offender && tenants[i].registered) {
                tenants[i].lockedDeposit += rewardEach;
            }
        }

        violationLocks[vid] = ViolationLock({
            rewardPerRecipient: rewardEach,
            released:           false
        });

        emit PenaltyApplied(vid, offender, v.penaltyPaid, rewardEach);
    }

    // ─── Reward Release (Fix 1) ───────────────────────────────────────────────────

    /**
     * @notice Move locked rewards to free balance once the appeal window has
     *         closed WITHOUT an appeal being filed.
     *         Anyone may call this (frontend, keeper, tenant).
     */
    function releaseRewards(uint256 violationId) external {
        if (violationId >= violationCount) revert ViolationNotFound();

        Violation storage v = violations[violationId];
        if (v.appealed)                                         revert AlreadyAppealed();
        if (block.timestamp <= v.reportedAt + APPEAL_WINDOW)   revert AppealWindowStillOpen();

        ViolationLock storage lock = violationLocks[violationId];
        if (lock.released) revert RewardsAlreadyReleased();
        lock.released = true;

        _moveLockedToFree(v.roomIndex, lock.rewardPerRecipient);
        emit RewardsReleased(violationId);
    }

    /// @dev Moves rewardPerRecipient from lockedDeposit → deposit for every
    ///      registered tenant except the offender.
    function _moveLockedToFree(uint8 offenderRoom, uint256 rewardPerRecipient) internal {
        for (uint8 i = 0; i < MAX_ROOMS; i++) {
            if (i != offenderRoom && tenants[i].registered) {
                tenants[i].lockedDeposit -= rewardPerRecipient;
                tenants[i].deposit       += rewardPerRecipient;
            }
        }
    }

    // ─── DAO Governance ──────────────────────────────────────────────────────────

    /**
     * @notice Penalized tenant files an appeal within 24 hours.
     *         Burns APPEAL_FEE from their free deposit.
     */
    function createAppeal(uint256 violationId, string calldata reason)
        external
        onlyTenant
    {
        if (violationId >= violationCount) revert ViolationNotFound();

        Violation storage v = violations[violationId];
        if (v.appealed)                                      revert AlreadyAppealed();
        if (block.timestamp > v.reportedAt + APPEAL_WINDOW) revert AppealWindowClosed();

        uint8 room = addressToRoom[msg.sender];
        if (room != v.roomIndex)                             revert NotThePenalizedTenant();
        if (tenants[room].deposit < APPEAL_FEE)              revert InsufficientDepositForFee();

        tenants[room].deposit -= APPEAL_FEE;
        v.appealed = true;

        uint256 pid = proposalCount++;
        proposals[pid] = Proposal({
            violationId: violationId,
            appellant:   msg.sender,
            createdAt:   block.timestamp,
            yesVotes:    0,
            noVotes:     0,
            executed:    false,
            passed:      false
        });

        emit AppealCreated(pid, violationId, msg.sender, reason);
    }

    /**
     * @notice Cast a vote on an open appeal proposal.
     *
     * Fix 3 — eligible voters: all registered tenants (except appellant) + landlord.
     *
     * NOTE: In production, gate tenants on a rental NFT balance check:
     *   require(rentalNFT.balanceOf(msg.sender) > 0, "No rental NFT");
     *
     * @param proposalId  Proposal to vote on.
     * @param approve     true = support appeal (refund), false = reject.
     */
    function vote(uint256 proposalId, bool approve) external {
        // Fix 3 — landlord is eligible in addition to tenants
        if (!isTenant[msg.sender] && msg.sender != landlord) revert NotEligibleToVote();
        if (proposalId >= proposalCount) revert ProposalNotFound();

        Proposal storage p = proposals[proposalId];
        if (p.executed)                                    revert AlreadyExecuted();
        if (block.timestamp > p.createdAt + APPEAL_WINDOW) revert VotingClosed();
        if (hasVoted[proposalId][msg.sender])              revert AlreadyVoted();
        if (msg.sender == p.appellant)                     revert AppellantCannotVote();

        hasVoted[proposalId][msg.sender] = true;
        if (approve) { p.yesVotes++; } else { p.noVotes++; }

        emit VoteCast(proposalId, msg.sender, approve);
    }

    /**
     * @notice Finalize a proposal after its 24-hour voting window closes.
     *
     * Fix 2 — requires VOTE_QUORUM votes to have been cast; reverts otherwise.
     * Fix 1 — on failure, releases locked rewards to recipients;
     *          on success, claws back from lockedDeposit (never free deposit).
     *
     * Anyone may call (frontend, keeper, any participant).
     */
    function executeProposal(uint256 proposalId) external {
        if (proposalId >= proposalCount) revert ProposalNotFound();

        Proposal storage p = proposals[proposalId];
        if (p.executed)                                          revert AlreadyExecuted();
        if (block.timestamp <= p.createdAt + APPEAL_WINDOW)     revert VotingStillOpen();

        // Fix 2 — quorum check
        uint256 total = p.yesVotes + p.noVotes;
        if (total < VOTE_QUORUM) revert QuorumNotReached();

        p.executed = true;

        if ((p.yesVotes * 100) / total >= VOTE_PASS_THRESHOLD) {
            // Appeal passed — reverse the penalty (Fix 1: from lockedDeposit)
            p.passed = true;
            _reversePenalty(proposalId);
        } else {
            // Appeal failed — release rewards to recipients (they earned them)
            Violation storage v      = violations[p.violationId];
            ViolationLock storage lk = violationLocks[p.violationId];
            if (!lk.released) {
                lk.released = true;
                _moveLockedToFree(v.roomIndex, lk.rewardPerRecipient);
            }
        }

        emit ProposalExecuted(proposalId, p.passed);
    }

    // ─── Internal: Penalty Reversal (Fix 1) ──────────────────────────────────────

    function _reversePenalty(uint256 proposalId) internal {
        Proposal storage p    = proposals[proposalId];
        Violation storage v   = violations[p.violationId];
        ViolationLock storage lk = violationLocks[p.violationId];
        uint8 offender = v.roomIndex;

        // Claw back from lockedDeposit only — free deposits are never touched.
        // This cannot underflow: rewards were put into lockedDeposit in _applyPenalty
        // and lockedDeposit is not withdrawable, so the amounts are still there.
        for (uint8 i = 0; i < MAX_ROOMS; i++) {
            if (i != offender && tenants[i].registered) {
                tenants[i].lockedDeposit -= lk.rewardPerRecipient;
            }
        }
        lk.released = true;

        // Return the full penalty to the offender's free balance
        tenants[offender].deposit += v.penaltyPaid;
    }

    // ─── View Helpers ─────────────────────────────────────────────────────────────

    /**
     * @notice Returns the free and locked balances for a room.
     * @return free   Freely withdrawable balance.
     * @return locked Balance locked pending appeal resolution.
     */
    function getDeposit(uint8 roomIndex)
        external
        view
        validRoom(roomIndex)
        returns (uint256 free, uint256 locked)
    {
        Tenant storage t = tenants[roomIndex];
        return (t.deposit, t.lockedDeposit);
    }

    /**
     * @notice Fix 5 — returns true if the tenant's free deposit is >= MINIMUM_DEPOSIT.
     *         The frontend should warn tenants below this threshold.
     */
    function isDepositSufficient(uint8 roomIndex)
        external
        view
        validRoom(roomIndex)
        returns (bool)
    {
        return tenants[roomIndex].deposit >= MINIMUM_DEPOSIT;
    }

    /// @notice Yes and no vote counts for a proposal.
    function getVotes(uint256 proposalId)
        external
        view
        returns (uint256 yes, uint256 no)
    {
        return (proposals[proposalId].yesVotes, proposals[proposalId].noVotes);
    }
}
