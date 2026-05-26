// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RentEscrow.sol";

contract RentEscrowTest is Test {
    RentEscrow public escrow;

    address public landlord;
    address public oracle;
    uint256 public oracleKey;

    address[5] public tenantAddrs;
    string[5]  public roomNames = ["Alice", "Bob", "Charlie", "David", "Eve"];

    // ─── Setup ────────────────────────────────────────────────────────────────────

    function setUp() public {
        landlord = makeAddr("landlord");
        (oracle, oracleKey) = makeAddrAndKey("oracle");

        for (uint8 i = 0; i < 5; i++) {
            tenantAddrs[i] = makeAddr(roomNames[i]);
            vm.deal(tenantAddrs[i], 10 ether);
        }

        vm.prank(landlord);
        escrow = new RentEscrow(oracle);

        vm.startPrank(landlord);
        for (uint8 i = 0; i < 5; i++) {
            escrow.registerTenant(i, tenantAddrs[i]);
        }
        vm.stopPrank();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    /// Build an oracle signature for (roomIndex, decibels, nonce).
    function _oracleSig(uint8 room, uint256 db, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 msgHash = keccak256(
            abi.encodePacked(block.chainid, address(escrow), room, db, nonce)
        );
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    /// Build a signature using a custom private key (for multi-oracle tests).
    function _sigWithKey(uint256 key, uint8 room, uint256 db, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 msgHash = keccak256(
            abi.encodePacked(block.chainid, address(escrow), room, db, nonce)
        );
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethHash);
        return abi.encodePacked(r, s, v);
    }

    /// All 5 tenants deposit `amount`.
    function _depositAll(uint256 amount) internal {
        for (uint8 i = 0; i < 5; i++) {
            vm.prank(tenantAddrs[i]);
            escrow.deposit{value: amount}();
        }
    }

    /// Submit a noise report using the current nonce and return the violation ID.
    function _reportNoise(uint8 room, uint256 db) internal returns (uint256 vid) {
        uint256 nonce = escrow.reportNonce();
        bytes memory sig = _oracleSig(room, db, nonce);
        escrow.reportNoise(room, db, nonce, sig);
        return escrow.violationCount() - 1;
    }

    /// Create a violation + appeal, return (violationId, proposalId).
    function _setupAppeal(uint8 room, uint256 db)
        internal
        returns (uint256 vid, uint256 pid)
    {
        _depositAll(2 ether);
        vid = _reportNoise(room, db);
        vm.prank(tenantAddrs[room]);
        escrow.createAppeal(vid, "Accident");
        pid = escrow.proposalCount() - 1;
    }

    // ─── 1. Registration ──────────────────────────────────────────────────────────

    function test_RegistrationStoresAddress() public view {
        assertEq(escrow.isTenant(tenantAddrs[0]), true);
        assertEq(escrow.tenantCount(), 5);
    }

    function test_RevertWhen_NonLandlordRegisters() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(RentEscrow.NotLandlord.selector);
        escrow.registerTenant(0, makeAddr("stranger"));
    }

    function test_RevertWhen_RoomAlreadyOccupied() public {
        vm.prank(landlord);
        vm.expectRevert(RentEscrow.RoomOccupied.selector);
        escrow.registerTenant(0, makeAddr("extra"));
    }

    // ─── 2. Deposit / Withdraw ────────────────────────────────────────────────────

    function test_DepositUpdatesBalance() public {
        vm.prank(tenantAddrs[0]);
        escrow.deposit{value: 2 ether}();
        (uint256 free,) = escrow.getDeposit(0);
        assertEq(free, 2 ether);
    }

    function test_RevertWhen_ZeroDeposit() public {
        vm.prank(tenantAddrs[0]);
        vm.expectRevert(RentEscrow.ZeroDeposit.selector);
        escrow.deposit{value: 0}();
    }

    function test_WithdrawSendsETH() public {
        vm.prank(tenantAddrs[0]);
        escrow.deposit{value: 2 ether}();
        uint256 before = tenantAddrs[0].balance;

        vm.prank(tenantAddrs[0]);
        escrow.withdraw();

        (uint256 free,) = escrow.getDeposit(0);
        assertEq(free, 0);
        assertEq(tenantAddrs[0].balance, before + 2 ether);
    }

    function test_RevertWhen_NothingToWithdraw() public {
        vm.prank(tenantAddrs[0]);
        vm.expectRevert(RentEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    function testFuzz_DepositAndWithdraw(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(tenantAddrs[1], amount);

        vm.prank(tenantAddrs[1]);
        escrow.deposit{value: amount}();

        vm.prank(tenantAddrs[1]);
        escrow.withdraw();

        (uint256 free,) = escrow.getDeposit(1);
        assertEq(free, 0);
    }

    // ─── 3. Fix 7 — Multi-Oracle ──────────────────────────────────────────────────

    function test_AddOracleAndUseIt() public {
        (, uint256 key2) = makeAddrAndKey("oracle2");
        address oracle2  = vm.addr(key2);

        vm.prank(landlord);
        escrow.addOracle(oracle2);
        assertEq(escrow.oracleCount(), 2);

        _depositAll(2 ether);
        uint256 nonce = escrow.reportNonce();
        bytes memory sig2 = _sigWithKey(key2, 0, 80, nonce);
        escrow.reportNoise(0, 80, nonce, sig2);
        assertEq(escrow.violationCount(), 1);
    }

    function test_RevertWhen_RemovedOracleSubmits() public {
        // Need a second oracle before removing the first
        vm.prank(landlord);
        escrow.addOracle(makeAddr("oracle2"));

        vm.prank(landlord);
        escrow.removeOracle(oracle);

        _depositAll(2 ether);
        uint256 nonce = escrow.reportNonce();
        bytes memory sig = _oracleSig(0, 80, nonce);

        vm.expectRevert(RentEscrow.NotAnOracle.selector);
        escrow.reportNoise(0, 80, nonce, sig);
    }

    function test_RevertWhen_RemoveLastOracle() public {
        vm.prank(landlord);
        vm.expectRevert(RentEscrow.MinOraclesRequired.selector);
        escrow.removeOracle(oracle);
    }

    function test_RevertWhen_AddSameOracleTwice() public {
        vm.prank(landlord);
        vm.expectRevert(RentEscrow.OracleAlreadyAdded.selector);
        escrow.addOracle(oracle);
    }

    // ─── 4. Fix 6 — Nonce-Based Replay Protection ────────────────────────────────

    function test_NonceIncrementsAfterReport() public {
        _depositAll(2 ether);
        assertEq(escrow.reportNonce(), 0);
        _reportNoise(0, 80);
        assertEq(escrow.reportNonce(), 1);
    }

    function test_RevertWhen_WrongNonce() public {
        _depositAll(2 ether);
        uint256 badNonce = 99;
        bytes memory sig = _oracleSig(0, 80, badNonce);
        vm.expectRevert(RentEscrow.InvalidNonce.selector);
        escrow.reportNoise(0, 80, badNonce, sig);
    }

    function test_RevertWhen_NonceReplay() public {
        _depositAll(2 ether);
        uint256 nonce = escrow.reportNonce(); // = 0
        bytes memory sig = _oracleSig(0, 80, nonce);
        escrow.reportNoise(0, 80, nonce, sig); // succeeds; nonce → 1

        // Re-fund offender so the deposit check doesn't fail first
        vm.prank(tenantAddrs[0]);
        escrow.deposit{value: 1 ether}();

        // Attempt replay with nonce = 0 (now stale)
        vm.expectRevert(RentEscrow.InvalidNonce.selector);
        escrow.reportNoise(0, 80, nonce, sig);
    }

    // ─── 5. Fix 4 — Tiered Penalties ─────────────────────────────────────────────

    function test_PenaltyTierLow_71to85dB() public {
        _depositAll(2 ether);
        _reportNoise(0, 80); // 80 dB → PENALTY_LOW
        (uint256 free,) = escrow.getDeposit(0);
        assertEq(free, 2 ether - escrow.PENALTY_LOW());
    }

    function test_PenaltyTierMed_86to100dB() public {
        _depositAll(2 ether);
        _reportNoise(0, 90); // 90 dB → PENALTY_MED
        (uint256 free,) = escrow.getDeposit(0);
        assertEq(free, 2 ether - escrow.PENALTY_MED());
    }

    function test_PenaltyTierHigh_over100dB() public {
        _depositAll(2 ether);
        _reportNoise(0, 110); // 110 dB → PENALTY_HIGH
        (uint256 free,) = escrow.getDeposit(0);
        assertEq(free, 2 ether - escrow.PENALTY_HIGH());
    }

    function test_RevertWhen_BelowNoiseThreshold() public {
        _depositAll(2 ether);
        uint256 nonce = escrow.reportNonce();
        bytes memory sig = _oracleSig(0, 65, nonce); // 65 dB ≤ 70
        vm.expectRevert(RentEscrow.BelowNoiseThreshold.selector);
        escrow.reportNoise(0, 65, nonce, sig);
    }

    function test_RevertWhen_InvalidOracleSignature() public {
        _depositAll(2 ether);
        (, uint256 fakeKey) = makeAddrAndKey("fake");
        uint256 nonce = escrow.reportNonce();
        bytes memory badSig = _sigWithKey(fakeKey, 0, 80, nonce);
        vm.expectRevert(RentEscrow.NotAnOracle.selector);
        escrow.reportNoise(0, 80, nonce, badSig);
    }

    // ─── 6. Fix 1 — Locked Rewards ────────────────────────────────────────────────

    function test_RewardsGoToLockedNotFree() public {
        _depositAll(2 ether);
        _reportNoise(0, 80); // PENALTY_LOW distributed

        uint256 rewardEach = escrow.PENALTY_LOW() / 4;
        for (uint8 i = 1; i < 5; i++) {
            (uint256 free, uint256 locked) = escrow.getDeposit(i);
            assertEq(free,   2 ether);     // free balance unchanged
            assertEq(locked, rewardEach);  // reward is locked
        }
    }

    function test_WithdrawCannotTouchLockedBalance() public {
        _depositAll(2 ether);
        _reportNoise(0, 80);

        (, uint256 lockedBefore) = escrow.getDeposit(1);
        assertGt(lockedBefore, 0);

        // Bob withdraws only his free balance
        vm.prank(tenantAddrs[1]);
        escrow.withdraw();

        (uint256 freeAfter, uint256 lockedAfter) = escrow.getDeposit(1);
        assertEq(freeAfter,  0);
        assertEq(lockedAfter, lockedBefore); // locked is untouched
    }

    function test_ReleaseRewards_MovesLockedToFree() public {
        _depositAll(2 ether);
        uint256 vid = _reportNoise(0, 80);
        uint256 rewardEach = escrow.PENALTY_LOW() / 4;

        vm.warp(block.timestamp + 25 hours);
        escrow.releaseRewards(vid);

        for (uint8 i = 1; i < 5; i++) {
            (uint256 free, uint256 locked) = escrow.getDeposit(i);
            assertEq(free,   2 ether + rewardEach); // now in free
            assertEq(locked, 0);
        }
    }

    function test_RevertWhen_ReleaseRewards_WindowStillOpen() public {
        _depositAll(2 ether);
        uint256 vid = _reportNoise(0, 80);
        vm.expectRevert(RentEscrow.AppealWindowStillOpen.selector);
        escrow.releaseRewards(vid);
    }

    function test_RevertWhen_ReleaseRewards_Twice() public {
        _depositAll(2 ether);
        uint256 vid = _reportNoise(0, 80);
        vm.warp(block.timestamp + 25 hours);
        escrow.releaseRewards(vid);
        vm.expectRevert(RentEscrow.RewardsAlreadyReleased.selector);
        escrow.releaseRewards(vid);
    }

    function test_RevertWhen_ReleaseRewards_WhileUnderAppeal() public {
        (uint256 vid,) = _setupAppeal(0, 80);
        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert(RentEscrow.AlreadyAppealed.selector);
        escrow.releaseRewards(vid);
    }

    // Critical fix: prove the old underflow bug no longer exists.
    // Recipients withdraw their free balance (which does NOT include locked rewards).
    // Then the appeal passes and _reversePenalty claws back from lockedDeposit — no panic.
    function test_Fix1_ReversePenaltyWorksEvenAfterRecipientWithdraws() public {
        (, uint256 pid) = _setupAppeal(0, 80);

        // Bob, Charlie, David withdraw their free deposits
        // (locked rewards remain in lockedDeposit — cannot be withdrawn)
        vm.prank(tenantAddrs[1]); escrow.withdraw();
        vm.prank(tenantAddrs[2]); escrow.withdraw();
        vm.prank(tenantAddrs[3]); escrow.withdraw();

        // Vote: 3 yes → meets quorum (3) and 60% threshold
        vm.prank(tenantAddrs[1]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[2]); escrow.vote(pid, true);
        vm.prank(landlord);       escrow.vote(pid, true);

        vm.warp(block.timestamp + 25 hours);

        // This must NOT revert (was the underflow bug)
        escrow.executeProposal(pid);

        (,,,,, bool executed, bool passed) = escrow.proposals(pid);
        assertTrue(executed);
        assertTrue(passed);

        // Locked balances of recipients are now zero
        for (uint8 i = 1; i < 5; i++) {
            (, uint256 locked) = escrow.getDeposit(i);
            assertEq(locked, 0);
        }

        // Alice's penalty is refunded (minus appeal fee)
        (uint256 aliceFree,) = escrow.getDeposit(0);
        assertEq(aliceFree, 2 ether - escrow.APPEAL_FEE());
    }

    // ─── 7. Fix 2 — Quorum ────────────────────────────────────────────────────────

    function test_RevertWhen_QuorumNotMet() public {
        (, uint256 pid) = _setupAppeal(0, 80);

        // Only 2 votes cast — below VOTE_QUORUM (3)
        vm.prank(tenantAddrs[1]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[2]); escrow.vote(pid, true);

        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert(RentEscrow.QuorumNotReached.selector);
        escrow.executeProposal(pid);
    }

    function test_ProposalPassesWithQuorum() public {
        (, uint256 pid) = _setupAppeal(0, 80);

        // 3 yes votes — meets quorum (3) and 100% > 60%
        vm.prank(tenantAddrs[1]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[2]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[3]); escrow.vote(pid, true);

        vm.warp(block.timestamp + 25 hours);
        escrow.executeProposal(pid);

        (,,,,, bool executed, bool passed) = escrow.proposals(pid);
        assertTrue(executed);
        assertTrue(passed);
    }

    function test_ExecuteEarlyWhenAllEligibleVotersHaveVoted() public {
        (, uint256 pid) = _setupAppeal(0, 80);

        // Eligible voters are the 4 non-appellant tenants + landlord.
        vm.prank(tenantAddrs[1]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[2]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[3]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[4]); escrow.vote(pid, true);
        vm.prank(landlord);       escrow.vote(pid, true);

        // No time warp: all eligible voters are done, so early execution is allowed.
        escrow.executeProposal(pid);

        (,,,,, bool executed, bool passed) = escrow.proposals(pid);
        assertTrue(executed);
        assertTrue(passed);
    }

    // ─── 8. Fix 3 — Landlord Votes ───────────────────────────────────────────────

    function test_LandlordCanVote() public {
        (, uint256 pid) = _setupAppeal(0, 80);

        vm.prank(landlord);
        escrow.vote(pid, true);

        (uint256 yes,) = escrow.getVotes(pid);
        assertEq(yes, 1);
    }

    function test_LandlordVoteCountsTowardsQuorum() public {
        (, uint256 pid) = _setupAppeal(0, 80);

        // 2 tenants + landlord = 3 votes → meets quorum
        vm.prank(tenantAddrs[1]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[2]); escrow.vote(pid, true);
        vm.prank(landlord);       escrow.vote(pid, true);

        vm.warp(block.timestamp + 25 hours);
        escrow.executeProposal(pid); // must not revert QuorumNotReached
    }

    function test_RevertWhen_NonParticipantVotes() public {
        (, uint256 pid) = _setupAppeal(0, 80);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(RentEscrow.NotEligibleToVote.selector);
        escrow.vote(pid, true);
    }

    // ─── 9. Fix 5 — Minimum Deposit Helper ───────────────────────────────────────

    function test_IsDepositSufficient_False_WhenEmpty() public view {
        assertFalse(escrow.isDepositSufficient(0));
    }

    function test_IsDepositSufficient_True_WhenFunded() public {
        // Compute the value before vm.prank — otherwise the constant-getter call
        // consumes the prank and deposit() runs as the test contract (not a tenant).
        uint256 minDeposit = escrow.MINIMUM_DEPOSIT();
        vm.prank(tenantAddrs[0]);
        escrow.deposit{value: minDeposit}();
        assertTrue(escrow.isDepositSufficient(0));
    }

    // ─── 10. Full DAO Lifecycle ───────────────────────────────────────────────────

    function test_AppealFailed_LockedRewardsReleasedToRecipients() public {
        (, uint256 pid) = _setupAppeal(0, 80);
        uint256 rewardEach = escrow.PENALTY_LOW() / 4;

        // 3 no votes — quorum met, appeal fails
        vm.prank(tenantAddrs[1]); escrow.vote(pid, false);
        vm.prank(tenantAddrs[2]); escrow.vote(pid, false);
        vm.prank(tenantAddrs[3]); escrow.vote(pid, false);

        vm.warp(block.timestamp + 25 hours);
        escrow.executeProposal(pid);

        // Locked rewards moved to free balance for recipients
        for (uint8 i = 1; i < 5; i++) {
            (uint256 free, uint256 locked) = escrow.getDeposit(i);
            assertEq(free,   2 ether + rewardEach);
            assertEq(locked, 0);
        }
    }

    function test_RevertWhen_DoubleVote() public {
        (, uint256 pid) = _setupAppeal(0, 80);
        vm.prank(tenantAddrs[1]); escrow.vote(pid, true);
        vm.prank(tenantAddrs[1]);
        vm.expectRevert(RentEscrow.AlreadyVoted.selector);
        escrow.vote(pid, true);
    }

    function test_RevertWhen_AppellantVotes() public {
        (, uint256 pid) = _setupAppeal(0, 80);
        vm.prank(tenantAddrs[0]); // appellant
        vm.expectRevert(RentEscrow.AppellantCannotVote.selector);
        escrow.vote(pid, true);
    }

    function test_RevertWhen_VotingStillOpen() public {
        (, uint256 pid) = _setupAppeal(0, 80);
        vm.expectRevert(RentEscrow.VotingStillOpen.selector);
        escrow.executeProposal(pid);
    }

    function test_RevertWhen_AppealWindowClosed() public {
        _depositAll(2 ether);
        uint256 vid = _reportNoise(0, 80);

        vm.warp(block.timestamp + 25 hours);

        vm.prank(tenantAddrs[0]);
        vm.expectRevert(RentEscrow.AppealWindowClosed.selector);
        escrow.createAppeal(vid, "Too late");
    }

    function test_RevertWhen_NonOffenderAppeals() public {
        _depositAll(2 ether);
        uint256 vid = _reportNoise(0, 80);

        vm.prank(tenantAddrs[1]); // not the penalized room
        vm.expectRevert(RentEscrow.NotThePenalizedTenant.selector);
        escrow.createAppeal(vid, "Not my fault");
    }
}
