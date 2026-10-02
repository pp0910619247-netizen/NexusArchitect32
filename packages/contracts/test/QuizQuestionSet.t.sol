// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuizQuestionSet} from "../src/QuizQuestionSet.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Tests for the Amoy-only QuizQuestionSet. Everything runs with
///      `vm.chainId(80002)` because the contract refuses any other chain.
contract QuizQuestionSetTest is Test {
    uint256 internal constant AMOY = 80002;

    address internal owner = address(0xA11CE);
    address internal stranger = address(0xB0B);

    QuizQuestionSet internal set;

    /// @dev Real world-v2 opener: id, source hash of the exact bank JSONL line,
    ///      and the answer index that the bank grades as correct.
    string internal constant ITEM_ID = "w2-000001";
    bytes32 internal constant SOURCE_HASH =
        0x1a7ae9d69a5ba8dbb081f9dc2d627c93fa8ff09815a65d210b00df69f4ed16c2;
    uint8 internal constant ANSWER_INDEX = 1;
    /// @dev sha256 of the bank manifest (off-chain, carried as an opaque digest).
    bytes32 internal constant BANK_ROOT =
        0x60cf261f6db02e832a0b1b5d4d805821774292e9513a76e61974a5dc61098dbc;

    string internal constant PROMPT_TH =
        unicode"4 วิชาพร้อมกัน: เคมี · แพทยศาสตร์และสุขภาพ · เศรษฐศาสตร์ · ปรัชญาและตรรกศาสตร์\n[1] มวลโมลาร์ของคาร์บอนไดออกไซด์ (มก./โมล) / [2] จำนวนวินาทีใน 90 นาที / [3] จำนวนส่วนในล้านที่เท่ากับ 1 เปอร์เซ็นต์ / [4] จำนวนแถวของตารางความจริงที่มี 12 ตัวแปร\nตัวเลือกใดถูกต้องครบทุกรายการ (ตัวเลขทุกตัวต้องตรง)?";
    string internal constant PROMPT_EN =
        "4 subjects at once: Chemistry / Medicine & Health / Economics / Philosophy & Logic\n[1] molar mass of carbon dioxide (mg/mol) / [2] seconds in ninety minutes / [3] parts per million in one percent / [4] rows in a truth table with twelve variables\nWhich option is correct in every clause (every number must match)?";

    bytes32 internal constant SALT = keccak256("local-test-salt-not-a-secret");

    function setUp() public {
        vm.chainId(AMOY);
        vm.prank(owner);
        set = new QuizQuestionSet(owner);
    }

    /* ------------------------------------------------------------------ */
    /*                              helpers                               */
    /* ------------------------------------------------------------------ */

    function _longString(uint256 n) internal pure returns (string memory) {
        bytes memory body = new bytes(n);
        for (uint256 i; i < n; ++i) {
            body[i] = bytes1(uint8(97)); // "a", exactly one byte
        }
        return string(body);
    }

    function _filledOptionsTh(string memory value) internal pure returns (string[4] memory out) {
        for (uint256 i; i < 4; ++i) {
            out[i] = value;
        }
    }

    /// @dev Realistic fixture taken from `questions/world-v2`.
    function _realItem(bytes32 commit) internal pure returns (QuizQuestionSet.ItemInput memory input) {
        input.itemId = ITEM_ID;
        input.promptTh = PROMPT_TH;
        input.promptEn = PROMPT_EN;
        input.optionsTh = [
            unicode"44,009 มก./โมล · 5,400 วินาที · 1,000 ส่วนในล้าน · 4,096 แถว",
            unicode"44,009 มก./โมล · 5,400 วินาที · 10,000 ส่วนในล้าน · 4,096 แถว",
            unicode"44,008 มก./โมล · 5,400 วินาที · 10,000 ส่วนในล้าน · 2,048 แถว",
            unicode"44,008 มก./โมล · 5,401 วินาที · 1,000 ส่วนในล้าน · 4,096 แถว"
        ];
        input.optionsEn = [
            "44,009 mg/mol / 5,400 seconds / 1,000 ppm / 4,096 rows",
            "44,009 mg/mol / 5,400 seconds / 10,000 ppm / 4,096 rows",
            "44,008 mg/mol / 5,400 seconds / 10,000 ppm / 2,048 rows",
            "44,008 mg/mol / 5,401 seconds / 1,000 ppm / 4,096 rows"
        ];
        input.sourceHash = SOURCE_HASH;
        input.answerCommit = commit;
    }

    /// @dev Minimal valid item (tiny text) for boundary/count tests.
    function _tinyItem(string memory id, bytes32 commit) internal pure returns (QuizQuestionSet.ItemInput memory input) {
        input.itemId = id;
        input.promptTh = "p";
        input.promptEn = "p";
        input.optionsTh = _filledOptionsTh("x");
        input.optionsEn = _filledOptionsTh("x");
        input.sourceHash = keccak256(bytes(id));
        input.answerCommit = commit;
    }

    function _publish() internal returns (uint256 setId) {
        setId = 1;
        vm.prank(owner);
        set.publishSet(setId, BANK_ROOT, "world-v2", 10_000);
    }

    function _commit(uint256 setId, string memory itemId, uint8 answerIndex, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(setId, itemId, answerIndex, salt));
    }

    /* ------------------------------------------------------------------ */
    /*                          constructor / guard                       */
    /* ------------------------------------------------------------------ */

    function testConstructorBindsAmoy() public view {
        assertEq(set.chainIdBound(), AMOY);
        assertEq(set.AMOY_CHAIN_ID(), AMOY);
        assertEq(set.owner(), owner);
    }

    function testConstructorRejectsNonAmoy() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(QuizQuestionSet.ChainMismatch.selector, uint256(1)));
        new QuizQuestionSet(owner);
    }

    function testWriteGuardRejectsOtherChainId() public {
        _publish();
        vm.chainId(137);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(QuizQuestionSet.ChainMismatch.selector, uint256(137)));
        set.storeItem(1, _realItem(_commit(1, ITEM_ID, ANSWER_INDEX, SALT)));
    }

    /* ------------------------------------------------------------------ */
    /*                             publishSet                             */
    /* ------------------------------------------------------------------ */

    function testPublishSetStoresRootAndCount() public {
        // the publish itself emits SetPublished for set 1
        vm.expectEmit(true, true, false, true, address(set));
        emit QuizQuestionSet.SetPublished(1, BANK_ROOT, "world-v2", 10_000, AMOY);
        _publish();

        // a second set is a separate record and does not disturb the first
        vm.prank(owner);
        set.publishSet(2, keccak256("second-root"), "world-v1", 10_000);

        QuizQuestionSet.QuestionSet memory record = set.getSet(1);
        assertEq(record.bankRoot, BANK_ROOT);
        assertEq(record.schema, "world-v2");
        assertEq(record.questionCount, 10_000);
        assertEq(record.itemCount, 0);
        assertTrue(record.published);
        assertEq(set.getSet(2).bankRoot, keccak256("second-root"));
    }

    function testPublishSetValidation() public {
        vm.startPrank(owner);
        vm.expectRevert(QuizQuestionSet.InvalidSetId.selector);
        set.publishSet(0, BANK_ROOT, "world-v2", 10_000);

        vm.expectRevert(QuizQuestionSet.InvalidBankRoot.selector);
        set.publishSet(1, bytes32(0), "world-v2", 10_000);

        vm.expectRevert(QuizQuestionSet.InvalidSchema.selector);
        set.publishSet(1, BANK_ROOT, "", 10_000);

        vm.expectRevert(QuizQuestionSet.TextTooLong.selector);
        set.publishSet(1, BANK_ROOT, "schema-that-is-way-too-long-for-the-cap", 10_000);

        vm.expectRevert(QuizQuestionSet.InvalidCount.selector);
        set.publishSet(1, BANK_ROOT, "world-v2", 0);

        // valid publish, then a duplicate must fail
        set.publishSet(1, BANK_ROOT, "world-v2", 10_000);
        vm.expectRevert(QuizQuestionSet.AlreadyPublished.selector);
        set.publishSet(1, BANK_ROOT, "world-v2", 10_000);
        vm.stopPrank();
    }

    function testPublishSetRejectsNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        set.publishSet(1, BANK_ROOT, "world-v2", 10_000);
    }

    /* ------------------------------------------------------------------ */
    /*                              storeItem                             */
    /* ------------------------------------------------------------------ */

    function testStoreItemRoundTripsBilingualText() public {
        _publish();
        QuizQuestionSet.ItemInput memory input = _realItem(_commit(1, ITEM_ID, ANSWER_INDEX, SALT));

        vm.prank(owner);
        set.storeItem(1, input);

        QuizQuestionSet.Item memory stored = set.getItem(1, ITEM_ID);
        assertTrue(stored.stored);
        assertFalse(stored.revealed);
        assertEq(stored.itemId, ITEM_ID);
        assertEq(stored.promptTh, PROMPT_TH);
        assertEq(stored.promptEn, PROMPT_EN);
        for (uint256 i; i < 4; ++i) {
            assertEq(stored.optionsTh[i], input.optionsTh[i]);
            assertEq(stored.optionsEn[i], input.optionsEn[i]);
        }
        assertEq(stored.sourceHash, SOURCE_HASH);
        assertEq(stored.answerCommit, input.answerCommit);
        assertEq(set.getSet(1).itemCount, 1);
        assertTrue(set.isStored(1, ITEM_ID));
        assertFalse(set.isRevealed(1, ITEM_ID));
    }

    function testStoreItemTextCapsAtBoundary() public {
        _publish();

        // exactly at the cap is accepted
        QuizQuestionSet.ItemInput memory atCap = _tinyItem("w2-cap", keccak256("cap"));
        atCap.promptTh = _longString(set.MAX_PROMPT_BYTES());
        atCap.promptEn = _longString(set.MAX_PROMPT_BYTES());
        atCap.optionsTh = _filledOptionsTh(_longString(set.MAX_OPTION_BYTES()));
        atCap.optionsEn = _filledOptionsTh(_longString(set.MAX_OPTION_BYTES()));
        vm.prank(owner);
        set.storeItem(1, atCap);
        assertEq(bytes(set.getItem(1, "w2-cap").promptTh).length, set.MAX_PROMPT_BYTES());

        // one byte over the cap is rejected
        QuizQuestionSet.ItemInput memory promptOver = _tinyItem("w2-over-prompt", keccak256("over"));
        promptOver.promptTh = _longString(set.MAX_PROMPT_BYTES() + 1);
        vm.prank(owner);
        vm.expectRevert(QuizQuestionSet.TextTooLong.selector);
        set.storeItem(1, promptOver);

        QuizQuestionSet.ItemInput memory optionOver = _tinyItem("w2-over-option", keccak256("over"));
        optionOver.optionsEn = _filledOptionsTh(_longString(set.MAX_OPTION_BYTES() + 1));
        vm.prank(owner);
        vm.expectRevert(QuizQuestionSet.TextTooLong.selector);
        set.storeItem(1, optionOver);

        // empty text is rejected
        QuizQuestionSet.ItemInput memory emptyPrompt = _tinyItem("w2-empty", keccak256("empty"));
        emptyPrompt.promptTh = "";
        vm.prank(owner);
        vm.expectRevert(QuizQuestionSet.EmptyText.selector);
        set.storeItem(1, emptyPrompt);

        QuizQuestionSet.ItemInput memory emptyOption = _tinyItem("w2-empty-opt", keccak256("empty"));
        emptyOption.optionsTh[2] = "";
        vm.prank(owner);
        vm.expectRevert(QuizQuestionSet.EmptyText.selector);
        set.storeItem(1, emptyOption);
    }

    function testStoreItemValidation() public {
        bytes32 commit = keccak256("commit");

        // unknown set
        vm.prank(owner);
        vm.expectRevert(QuizQuestionSet.UnknownSet.selector);
        set.storeItem(7, _tinyItem("w2-x", commit));

        _publish();

        vm.startPrank(owner);

        QuizQuestionSet.ItemInput memory noSource = _tinyItem("w2-x", commit);
        noSource.sourceHash = bytes32(0);
        vm.expectRevert(QuizQuestionSet.InvalidSourceHash.selector);
        set.storeItem(1, noSource);

        QuizQuestionSet.ItemInput memory noCommit = _tinyItem("w2-x", bytes32(0));
        vm.expectRevert(QuizQuestionSet.InvalidCommit.selector);
        set.storeItem(1, noCommit);

        QuizQuestionSet.ItemInput memory emptyId = _tinyItem("", commit);
        vm.expectRevert(QuizQuestionSet.EmptyText.selector);
        set.storeItem(1, emptyId);

        QuizQuestionSet.ItemInput memory longId = _tinyItem(_longString(set.MAX_ID_BYTES() + 1), commit);
        vm.expectRevert(QuizQuestionSet.TextTooLong.selector);
        set.storeItem(1, longId);

        // store once, then the same item id is rejected
        set.storeItem(1, _tinyItem("w2-dup", commit));
        vm.expectRevert(QuizQuestionSet.AlreadyStored.selector);
        set.storeItem(1, _tinyItem("w2-dup", commit));
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        set.storeItem(1, _tinyItem("w2-stranger", commit));
    }

    function testStoreItemStopsAtSetCap() public {
        _publish();
        uint256 cap = set.MAX_SET_ITEMS();
        vm.startPrank(owner);
        for (uint256 i; i < cap; ++i) {
            set.storeItem(1, _tinyItem(string(abi.encodePacked("w2-", vm.toString(i))), keccak256(abi.encode(i))));
        }
        assertEq(set.getSet(1).itemCount, cap);
        vm.expectRevert(QuizQuestionSet.TooManyItems.selector);
        set.storeItem(1, _tinyItem("w2-one-too-many", keccak256("overflow")));
        vm.stopPrank();
    }

    /* ------------------------------------------------------------------ */
    /*                            revealAnswer                            */
    /* ------------------------------------------------------------------ */

    function testRevealVerifiesCommitmentAndEmitsSalt() public {
        _publish();
        bytes32 commit = _commit(1, ITEM_ID, ANSWER_INDEX, SALT);
        vm.prank(owner);
        set.storeItem(1, _realItem(commit));

        // the public helper must reproduce the same preimage the deploy tooling uses
        assertEq(set.commitFor(1, ITEM_ID, ANSWER_INDEX, SALT), commit);

        bytes32 itemKey = set.itemKeyFor(ITEM_ID);
        vm.expectEmit(true, true, false, true, address(set));
        emit QuizQuestionSet.AnswerRevealed(1, itemKey, ANSWER_INDEX, SALT);

        vm.prank(owner);
        set.revealAnswer(1, ITEM_ID, ANSWER_INDEX, SALT);

        QuizQuestionSet.Item memory stored = set.getItem(1, ITEM_ID);
        assertTrue(stored.revealed);
        assertEq(stored.answerIndex, ANSWER_INDEX);
        assertTrue(set.isRevealed(1, ITEM_ID));
        // the commitment itself never changes
        assertEq(stored.answerCommit, commit);
    }

    function testRevealRejectsWrongPreimage() public {
        _publish();
        vm.prank(owner);
        set.storeItem(1, _realItem(_commit(1, ITEM_ID, ANSWER_INDEX, SALT)));
        vm.startPrank(owner);

        vm.expectRevert(QuizQuestionSet.AnswerMismatch.selector);
        set.revealAnswer(1, ITEM_ID, ANSWER_INDEX, keccak256("wrong-salt"));

        vm.expectRevert(QuizQuestionSet.AnswerMismatch.selector);
        set.revealAnswer(1, ITEM_ID, 3, SALT);

        vm.expectRevert(QuizQuestionSet.InvalidAnswerIndex.selector);
        set.revealAnswer(1, ITEM_ID, 4, SALT);

        vm.expectRevert(QuizQuestionSet.InvalidSalt.selector);
        set.revealAnswer(1, ITEM_ID, ANSWER_INDEX, bytes32(0));
        vm.stopPrank();

        // nothing leaked: the item is still unrevealed
        assertFalse(set.isRevealed(1, ITEM_ID));
    }

    function testRevealRejectsUnknownItemUnknownSetAndDoubleReveal() public {
        _publish();
        vm.prank(owner);
        set.storeItem(1, _realItem(_commit(1, ITEM_ID, ANSWER_INDEX, SALT)));

        vm.startPrank(owner);
        vm.expectRevert(QuizQuestionSet.UnknownItem.selector);
        set.revealAnswer(1, "w2-999999", ANSWER_INDEX, SALT);

        vm.expectRevert(QuizQuestionSet.UnknownSet.selector);
        set.revealAnswer(9, ITEM_ID, ANSWER_INDEX, SALT);

        set.revealAnswer(1, ITEM_ID, ANSWER_INDEX, SALT);
        vm.expectRevert(QuizQuestionSet.AlreadyRevealed.selector);
        set.revealAnswer(1, ITEM_ID, ANSWER_INDEX, SALT);
        vm.stopPrank();
    }

    function testRevealedAnswerIsUnreadableBeforeReveal() public {
        _publish();
        vm.prank(owner);
        set.storeItem(1, _realItem(_commit(1, ITEM_ID, ANSWER_INDEX, SALT)));

        // not revealed yet: the getter must refuse to answer
        vm.expectRevert(QuizQuestionSet.NotRevealed.selector);
        set.revealedAnswer(1, ITEM_ID);

        vm.prank(owner);
        set.revealAnswer(1, ITEM_ID, ANSWER_INDEX, SALT);
        assertEq(set.revealedAnswer(1, ITEM_ID), ANSWER_INDEX);

        vm.expectRevert(QuizQuestionSet.UnknownItem.selector);
        set.revealedAnswer(1, "w2-unknown");
    }

    function testRevealRejectsNonOwner() public {
        _publish();
        vm.prank(owner);
        set.storeItem(1, _realItem(_commit(1, ITEM_ID, ANSWER_INDEX, SALT)));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        set.revealAnswer(1, ITEM_ID, ANSWER_INDEX, SALT);
    }

    /* ------------------------------------------------------------------ */
    /*                        operator safety valves                      */
    /* ------------------------------------------------------------------ */

    function testPauseBlocksWritesAndUnpauseRestores() public {
        _publish();
        vm.prank(owner);
        set.pause();

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        set.publishSet(2, BANK_ROOT, "world-v2", 10_000);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        set.storeItem(1, _tinyItem("w2-paused", keccak256("paused")));
        vm.stopPrank();

        vm.prank(owner);
        set.unpause();
        vm.prank(owner);
        set.storeItem(1, _tinyItem("w2-resumed", keccak256("resumed")));
        assertTrue(set.isStored(1, "w2-resumed"));
    }

    function testOwnershipTransferIsTwoStep() public {
        vm.prank(owner);
        set.transferOwnership(stranger);
        assertEq(set.owner(), owner);
        assertEq(set.pendingOwner(), stranger);

        vm.prank(stranger);
        set.acceptOwnership();
        assertEq(set.owner(), stranger);
    }

    /* ------------------------------------------------------------------ */
    /*                        resource boundary                           */
    /* ------------------------------------------------------------------ */

    /// @dev The economic claim behind "one set on chain": a realistic item costs
    ///      a bounded amount of gas (see the logged value). Because EVM storage is
    ///      paid per 32-byte slot, the ceiling is what makes an on-chain item
    ///      affordable on a testnet while a whole bank (53 MB) is not.
    function testStoredItemGasIsBounded() public {
        _publish();
        QuizQuestionSet.ItemInput memory input = _realItem(_commit(1, ITEM_ID, ANSWER_INDEX, SALT));

        vm.prank(owner);
        uint256 before = gasleft();
        set.storeItem(1, input);
        uint256 used = before - gasleft();

        emit log_named_uint("storeItem gas (real item)", used);
        emit log_named_uint("prompt bytes (th+en)", bytes(input.promptTh).length + bytes(input.promptEn).length);
        assertTrue(used > 0 && used < 2_000_000, "storeItem gas exceeded the 2M ceiling");
        assertEq(set.getSet(1).itemCount, 1);
    }
}
