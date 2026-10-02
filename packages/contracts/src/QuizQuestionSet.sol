// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title QuizQuestionSet — one quiz set published on Polygon Amoy (testnet only).
/// @dev  Design intent, in one paragraph: the *bank* never goes on chain (the
///       world-v2 bank is 53 MB). What goes on chain is (a) a 32-byte root of
///       the bank manifest, (b) the full bilingual text of a small number of
///       items, and (c) a salted COMMITMENT to each answer. The answer index
///       stays hidden until the owner reveals it, and the reveal is checked
///       against the commitment, so nobody — including the owner — can change
///       the answer after players have seen the question.
/// @dev  Encoding note: the commitment is `keccak256(abi.encode(setId, itemId,
///       answerIndex, salt))`. ABI encoding is length-prefixed and unambiguous,
///       unlike string concatenation (`sha256(answer + salt)` collides across
///       different splits of the same bytes). `salt` must be 32 bytes of real
///       randomness and must never be committed to Git: it is the only thing
///       standing between a 2-bit answer space and a brute-force read.
/// @dev  Amoy-only by construction: the constructor and every write revert if
///       `block.chainid != 80002`. There is no mainnet path in this contract.
contract QuizQuestionSet is Ownable2Step, Pausable, ReentrancyGuard {
    /// @notice Polygon Amoy testnet chain id. Nothing else is accepted.
    uint256 public constant AMOY_CHAIN_ID = 80002;

    /// @notice Fixed choice count per item (the bank is 4-option multiple choice).
    uint256 public constant OPTION_COUNT = 4;

    /// @dev Byte caps keep the gas cost of one item predictable: the real
    ///      world-v2 opener (1,756 bytes of bilingual text) measures 1,683,736
    ///      gas in `testStoredItemGasIsBounded`, and the test fails if it ever
    ///      crosses 2M. Values are bytes, not characters — Thai characters cost
    ///      3 bytes each in UTF-8, which is why the caps are not character caps.
    uint256 public constant MAX_PROMPT_BYTES = 800;
    uint256 public constant MAX_OPTION_BYTES = 200;
    uint256 public constant MAX_ID_BYTES = 40;
    uint256 public constant MAX_SCHEMA_BYTES = 24;

    /// @notice Hard cap on items per set, so publishing can never become an
    ///         unbounded (unpayable) operation on a public testnet.
    uint256 public constant MAX_SET_ITEMS = 64;

    /// @notice Chain id this deployment is bound to (immutably Amoy).
    uint256 public immutable chainIdBound;

    struct QuestionSet {
        bytes32 bankRoot;
        string schema;
        uint32 questionCount;
        uint32 itemCount;
        bool published;
    }

    struct ItemInput {
        string itemId;
        string promptTh;
        string promptEn;
        string[4] optionsTh;
        string[4] optionsEn;
        bytes32 sourceHash;
        bytes32 answerCommit;
    }

    struct Item {
        string itemId;
        string promptTh;
        string promptEn;
        string[4] optionsTh;
        string[4] optionsEn;
        /// @dev sha256 of the exact bank JSONL line this item came from.
        bytes32 sourceHash;
        /// @dev keccak256(abi.encode(setId, itemId, answerIndex, salt)).
        bytes32 answerCommit;
        bool stored;
        bool revealed;
        uint8 answerIndex;
    }

    /// @dev setId => set record.
    mapping(uint256 => QuestionSet) private _sets;

    /// @dev setId => keccak256(itemId) => item record.
    mapping(uint256 => mapping(bytes32 => Item)) private _items;

    /// @dev Set ids are namespaced to the Amoy chain id, so the same bank can be
    ///      published per-environment without id collisions.
    mapping(uint256 => bool) private _knownSets;

    event SetPublished(
        uint256 indexed setId,
        bytes32 indexed bankRoot,
        string schema,
        uint32 questionCount,
        uint256 chainId
    );
    event ItemStored(uint256 indexed setId, bytes32 indexed itemKey, bytes32 sourceHash, bytes32 answerCommit);
    event AnswerRevealed(uint256 indexed setId, bytes32 indexed itemKey, uint8 answerIndex, bytes32 salt);

    error ChainMismatch(uint256 chainId);
    error InvalidSetId();
    error InvalidBankRoot();
    error InvalidSchema();
    error InvalidCount();
    error AlreadyPublished();
    error UnknownSet();
    error InvalidItemId();
    error EmptyText();
    error TextTooLong();
    error InvalidSourceHash();
    error InvalidCommit();
    error AlreadyStored();
    error UnknownItem();
    error TooManyItems();
    error AlreadyRevealed();
    error NotRevealed();
    error InvalidAnswerIndex();
    error InvalidSalt();
    error AnswerMismatch();

    /// @param initialOwner Node/operator wallet. Use a throwaway testnet key,
    ///        never a key that holds real funds (see packages/contracts/README.md).
    constructor(address initialOwner) Ownable(initialOwner) {
        chainIdBound = block.chainid;
        if (block.chainid != AMOY_CHAIN_ID) revert ChainMismatch(block.chainid);
    }

    modifier onlyAmoy() {
        if (block.chainid != AMOY_CHAIN_ID) revert ChainMismatch(block.chainid);
        _;
    }

    /// @notice Publishes (or re-declares) one set: the bank root plus its schema
    ///         and the number of questions the root covers.
    /// @param setId         Non-zero identifier, e.g. 1 for the first world-v2 set.
    /// @param bankRoot      sha256 of the bank manifest, computed off chain.
    /// @param schema       Bank schema label, e.g. "world-v2".
    /// @param questionCount Questions covered by `bankRoot` (10,000 for world-v2).
    function publishSet(uint256 setId, bytes32 bankRoot, string calldata schema, uint32 questionCount)
        external
        onlyOwner
        onlyAmoy
        whenNotPaused
    {
        if (setId == 0) revert InvalidSetId();
        if (bankRoot == 0) revert InvalidBankRoot();
        bytes calldata schemaBytes = bytes(schema);
        if (schemaBytes.length == 0) revert InvalidSchema();
        if (schemaBytes.length > MAX_SCHEMA_BYTES) revert TextTooLong();
        if (questionCount == 0) revert InvalidCount();

        QuestionSet storage set = _sets[setId];
        if (set.published) revert AlreadyPublished();

        set.bankRoot = bankRoot;
        set.schema = schema;
        set.questionCount = questionCount;
        set.published = true;
        _knownSets[setId] = true;

        emit SetPublished(setId, bankRoot, schema, questionCount, block.chainid);
    }

    /// @notice Stores one item's full bilingual text plus its answer commitment.
    /// @dev    The answer index is NOT accepted here — only `answerCommit`.
    function storeItem(uint256 setId, ItemInput calldata input)
        external
        onlyOwner
        onlyAmoy
        whenNotPaused
    {
        QuestionSet storage set = _sets[setId];
        if (!set.published) revert UnknownSet();
        if (set.itemCount >= MAX_SET_ITEMS) revert TooManyItems();

        _requireText(input.itemId, MAX_ID_BYTES);
        _requireText(input.promptTh, MAX_PROMPT_BYTES);
        _requireText(input.promptEn, MAX_PROMPT_BYTES);
        if (input.sourceHash == 0) revert InvalidSourceHash();
        if (input.answerCommit == 0) revert InvalidCommit();
        // Validated before the copy loop so that no revert happens inside a loop
        // (forge lint `require-revert-in-loop`) and each option reports which
        // error it is on its own.
        _requireText(input.optionsTh[0], MAX_OPTION_BYTES);
        _requireText(input.optionsTh[1], MAX_OPTION_BYTES);
        _requireText(input.optionsTh[2], MAX_OPTION_BYTES);
        _requireText(input.optionsTh[3], MAX_OPTION_BYTES);
        _requireText(input.optionsEn[0], MAX_OPTION_BYTES);
        _requireText(input.optionsEn[1], MAX_OPTION_BYTES);
        _requireText(input.optionsEn[2], MAX_OPTION_BYTES);
        _requireText(input.optionsEn[3], MAX_OPTION_BYTES);

        bytes32 itemKey = itemKeyFor(input.itemId);
        Item storage item = _items[setId][itemKey];
        if (item.stored) revert AlreadyStored();

        item.itemId = input.itemId;
        item.promptTh = input.promptTh;
        item.promptEn = input.promptEn;
        for (uint256 i; i < OPTION_COUNT; ++i) {
            item.optionsTh[i] = input.optionsTh[i];
            item.optionsEn[i] = input.optionsEn[i];
        }
        item.sourceHash = input.sourceHash;
        item.answerCommit = input.answerCommit;
        item.stored = true;

        set.itemCount = set.itemCount + 1;

        emit ItemStored(setId, itemKey, input.sourceHash, input.answerCommit);
    }

    /// @notice Reveals an answer by supplying the preimage of its commitment.
    /// @dev    Owner-only on purpose: with a 4-option space, a permissionless
    ///         reveal would let anyone leak the answer by guessing. The revealed
    ///         salt is emitted so that any observer can recompute the commitment
    ///         with `commitFor` and verify it.
    function revealAnswer(uint256 setId, string calldata itemId, uint8 answerIndex, bytes32 salt)
        external
        nonReentrant
        onlyOwner
        onlyAmoy
        whenNotPaused
    {
        if (!_knownSets[setId]) revert UnknownSet();
        if (answerIndex >= OPTION_COUNT) revert InvalidAnswerIndex();
        if (salt == 0) revert InvalidSalt();

        bytes32 itemKey = itemKeyFor(itemId);
        Item storage item = _items[setId][itemKey];
        if (!item.stored) revert UnknownItem();
        if (item.revealed) revert AlreadyRevealed();
        if (commitFor(setId, itemId, answerIndex, salt) != item.answerCommit) revert AnswerMismatch();

        item.revealed = true;
        item.answerIndex = answerIndex;

        emit AnswerRevealed(setId, itemKey, answerIndex, salt);
    }

    /// @notice Canonical commitment for an answer choice. Public and pure, so
    ///         anyone can verify a reveal against the stored commitment.
    function commitFor(uint256 setId, string memory itemId, uint8 answerIndex, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(setId, itemId, answerIndex, salt));
    }

    /// @notice Canonical storage key for an item id.
    function itemKeyFor(string memory itemId) public pure returns (bytes32) {
        return keccak256(bytes(itemId));
    }

    function getSet(uint256 setId) external view returns (QuestionSet memory) {
        if (!_knownSets[setId]) revert UnknownSet();
        return _sets[setId];
    }

    function getItem(uint256 setId, string calldata itemId) external view returns (Item memory) {
        Item memory item = _items[setId][itemKeyFor(itemId)];
        if (!item.stored) revert UnknownItem();
        return item;
    }

    function isStored(uint256 setId, string calldata itemId) external view returns (bool) {
        return _items[setId][itemKeyFor(itemId)].stored;
    }

    function isRevealed(uint256 setId, string calldata itemId) external view returns (bool) {
        return _items[setId][itemKeyFor(itemId)].revealed;
    }

    /// @notice The revealed answer index. Reverts until the owner has revealed
    ///         the item, so a caller can never read an unrevealed answer.
    function revealedAnswer(uint256 setId, string calldata itemId) external view returns (uint8) {
        Item memory item = _items[setId][itemKeyFor(itemId)];
        if (!item.stored) revert UnknownItem();
        if (!item.revealed) revert NotRevealed();
        return item.answerIndex;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _requireText(string calldata value, uint256 maxBytes) private pure {
        bytes calldata body = bytes(value);
        if (body.length == 0) revert EmptyText();
        if (body.length > maxBytes) revert TextTooLong();
    }
}
