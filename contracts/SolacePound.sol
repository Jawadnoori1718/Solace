// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SolacePound
 * @notice A GBP-denominated settlement token for fuel poverty support.
 *
 * @dev WHAT THIS IS, STATED PLAINLY
 *
 * SolacePound is a TESTNET DEMONSTRATION TOKEN. It holds no value, it is not a
 * payment instrument, and it is not money. It stands in for a regulated,
 * fully-backed GBP stablecoin, which is what a production deployment would use
 * and which would be issued by a regulated e-money institution rather than by
 * this contract.
 *
 * It exists to demonstrate one thing: that every pound a council commits to
 * fuel poverty support can be followed, publicly and in real time, from the
 * moment it enters a pot to the moment it becomes kilowatt-hours in somebody's
 * home.
 *
 * @dev DENOMINATION
 *
 * `decimals` is 2, not the customary 18. One SLP is one pound sterling and the
 * smallest unit is one penny. This is deliberate. Every amount in this system
 * originates as an integer number of pence in the council's ledger, so a
 * two-decimal token maps to it exactly, with no scaling and no rounding. A
 * block explorer then shows "2,500.00 SLP" against a pot the council funded
 * with £2,500.00, and the two figures are the same figure.
 *
 * @dev PRIVACY
 *
 * No personal data reaches this contract, and none can. Recipients appear only
 * as `recipientHash`, an HMAC-SHA256 of an internal household reference
 * computed off-chain under a secret salt. The contract cannot reverse it, and
 * neither can anybody reading the chain. The mapping from hash back to a
 * household exists solely in the council's own database.
 *
 * The salt is not decoration. This pilot covers a small number of households,
 * so a plain unsalted hash of a household reference could be brute-forced in
 * seconds. A keyed HMAC under a secret salt is what makes the identifier
 * genuinely opaque.
 */
contract SolacePound is ERC20, Ownable {
    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    /// @notice The caller is not authorised to settle allocations.
    error NotASettler(address caller);

    /// @notice A pot reference of zero is almost always a caller bug.
    error InvalidPotReference();

    /// @notice A recipient hash of zero is almost always a caller bug.
    error InvalidRecipientHash();

    /// @notice Energy quantities must be positive to be worth recording.
    error InvalidEnergyAmount();

    /// @notice Settlement amounts must be positive.
    error InvalidSettlementAmount();

    /**
     * @notice The pot does not hold enough to cover this settlement.
     * @dev This is the constraint that makes the pot real rather than
     *      decorative. A council pot cannot be overspent, and the chain — not
     *      the application — is what enforces it.
     */
    error PotOverdrawn(bytes32 potReference, uint256 availablePence, uint256 requestedPence);

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    /**
     * @notice A council has placed money into a pot.
     * @param potReference    Public pot identifier, e.g. "WINTER-2026".
     * @param treasury        Address now holding the pot's tokens.
     * @param amountPence     Amount added, in pence.
     * @param councilReference The council's own payment reference, so a finance
     *                        officer can reconcile this against their ledger.
     */
    event PotFunded(
        bytes32 indexed potReference,
        address indexed treasury,
        uint256 amountPence,
        string councilReference
    );

    /**
     * @notice Energy has been delivered to a household and paid for from a pot.
     *
     * @dev This event is the product. Everything else in this contract exists so
     *      that this can be emitted truthfully. It carries the four facts a
     *      councillor is entitled to have independently verifiable — how much
     *      energy, to whom (as an opaque identifier), from which pot, and when —
     *      and nothing that could identify a household.
     *
     * @param potReference   The pot the money came from.
     * @param recipientHash  HMAC of the recipient household's internal reference.
     * @param recipientMarker Deterministic address derived from `recipientHash`.
     * @param milliKwh       Energy delivered, in thousandths of a kilowatt-hour.
     *                       An integer, because there is no floating point here
     *                       and an auditable quantity should not have any.
     * @param amountPence    Amount deducted from the pot, in pence.
     * @param settledAt      Block timestamp of settlement.
     * @param sequence       Monotonic counter, so settlements have a total order
     *                       independent of block ordering.
     */
    event AllocationSettled(
        bytes32 indexed potReference,
        bytes32 indexed recipientHash,
        address indexed recipientMarker,
        uint64 milliKwh,
        uint256 amountPence,
        uint256 settledAt,
        uint256 sequence
    );

    /// @notice An address has been granted or revoked permission to settle.
    event SettlerUpdated(address indexed settler, bool allowed);

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /// @notice Addresses permitted to call `settle`.
    mapping(address settler => bool allowed) public isSettler;

    /// @notice Total placed into each pot, in pence.
    mapping(bytes32 potReference => uint256 pence) public potFundedPence;

    /// @notice Total settled out of each pot, in pence.
    mapping(bytes32 potReference => uint256 pence) public potSpentPence;

    /// @notice Total received by each hashed recipient, in pence.
    mapping(bytes32 recipientHash => uint256 pence) public recipientReceivedPence;

    /// @notice Total energy delivered to each hashed recipient, in milli-kWh.
    mapping(bytes32 recipientHash => uint256 milliKwh) public recipientMilliKwh;

    /// @notice Number of settlements recorded against each hashed recipient.
    /// @dev Read by the dashboard to explain why a household appears repeatedly.
    mapping(bytes32 recipientHash => uint256 count) public recipientSettlementCount;

    /// @notice Total number of settlements this contract has recorded.
    uint256 public settlementCount;

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    /**
     * @param initialOwner The council treasury. It owns the contract, funds
     *                     pots, and is authorised to settle from the outset.
     */
    constructor(address initialOwner) ERC20("SolacePound", "SLP") Ownable(initialOwner) {
        isSettler[initialOwner] = true;
        emit SettlerUpdated(initialOwner, true);
    }

    /**
     * @notice One SLP is one pound. The smallest unit is one penny.
     * @dev See the denomination note in the contract documentation above.
     */
    function decimals() public pure override returns (uint8) {
        return 2;
    }

    // -----------------------------------------------------------------------
    // Administration
    // -----------------------------------------------------------------------

    /// @notice Grant or revoke permission to settle allocations.
    function setSettler(address settler, bool allowed) external onlyOwner {
        isSettler[settler] = allowed;
        emit SettlerUpdated(settler, allowed);
    }

    modifier onlySettler() {
        if (!isSettler[msg.sender]) revert NotASettler(msg.sender);
        _;
    }

    // -----------------------------------------------------------------------
    // Funding a pot
    // -----------------------------------------------------------------------

    /**
     * @notice Place council money into a pot.
     *
     * @dev Beat one of the demonstration: a councillor commits a winter fund and
     *      watches it confirm.
     *
     *      Tokens are minted here because this is a demonstration token with no
     *      issuer behind it. In a production deployment the council would
     *      transfer existing regulated stablecoin from its own balance and this
     *      function would move tokens rather than create them. The accounting
     *      that follows — and the overdraw protection in `settle` — is identical
     *      either way.
     *
     * @param potReference     Public pot identifier.
     * @param treasury         Address to hold the pot's tokens.
     * @param amountPence      Amount to add, in pence.
     * @param councilReference The council's own payment reference.
     */
    function fundPot(
        bytes32 potReference,
        address treasury,
        uint256 amountPence,
        string calldata councilReference
    ) external onlyOwner {
        if (potReference == bytes32(0)) revert InvalidPotReference();
        if (amountPence == 0) revert InvalidSettlementAmount();

        potFundedPence[potReference] += amountPence;
        _mint(treasury, amountPence);

        emit PotFunded(potReference, treasury, amountPence, councilReference);
    }

    // -----------------------------------------------------------------------
    // Settlement
    // -----------------------------------------------------------------------

    /**
     * @notice Record that energy was delivered to a household, and pay for it.
     *
     * @dev Beats four and six of the demonstration. Tokens move out of the
     *      settler's balance to the recipient's marker address, the pot's
     *      remaining balance falls, and the `AllocationSettled` event records
     *      what happened in a form anyone can read on a block explorer.
     *
     *      The tokens are sent to `recipientMarker`, an address derived
     *      deterministically from the recipient hash. To be explicit about what
     *      that is: nobody holds the private key to that address, so this is a
     *      demonstration marker recording that credit belongs to a particular
     *      household, not a transfer into a household's own wallet. A production
     *      deployment would credit either a household-controlled wallet or a
     *      regulated custodian who redeems the balance against the household's
     *      energy account. The audit trail is the same in both cases; only the
     *      redemption step differs, and that step is out of scope here.
     *
     * @param potReference  The pot to draw from.
     * @param recipientHash HMAC of the recipient's internal reference. Computed
     *                      off-chain. This contract never sees the pre-image.
     * @param milliKwh      Energy delivered, in thousandths of a kilowatt-hour.
     * @param amountPence   Amount to deduct from the pot, in pence.
     */
    function settle(
        bytes32 potReference,
        bytes32 recipientHash,
        uint64 milliKwh,
        uint256 amountPence
    ) external onlySettler {
        if (potReference == bytes32(0)) revert InvalidPotReference();
        if (recipientHash == bytes32(0)) revert InvalidRecipientHash();
        if (milliKwh == 0) revert InvalidEnergyAmount();
        if (amountPence == 0) revert InvalidSettlementAmount();

        // A pot cannot be overspent. Enforced here rather than in the
        // application, so the guarantee survives a bug in our own code.
        uint256 funded = potFundedPence[potReference];
        uint256 spent = potSpentPence[potReference];
        uint256 available = funded - spent;
        if (amountPence > available) {
            revert PotOverdrawn(potReference, available, amountPence);
        }

        address recipientMarker = markerAddress(recipientHash);

        potSpentPence[potReference] = spent + amountPence;
        recipientReceivedPence[recipientHash] += amountPence;
        recipientMilliKwh[recipientHash] += milliKwh;
        recipientSettlementCount[recipientHash] += 1;

        uint256 sequence = ++settlementCount;

        // Moves tokens and emits the standard ERC-20 Transfer event, so the
        // settlement is visible both as a token movement and as the richer
        // AllocationSettled record below.
        _transfer(msg.sender, recipientMarker, amountPence);

        emit AllocationSettled(
            potReference,
            recipientHash,
            recipientMarker,
            milliKwh,
            amountPence,
            block.timestamp,
            sequence
        );
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /**
     * @notice What remains in a pot, in pence.
     * @dev The dashboard reads this rather than trusting its own arithmetic, so
     *      the balance on screen is the balance the chain agrees to.
     */
    function potBalancePence(bytes32 potReference) external view returns (uint256) {
        return potFundedPence[potReference] - potSpentPence[potReference];
    }

    /**
     * @notice The deterministic marker address for a hashed recipient.
     * @dev Truncating a hash to twenty bytes is exactly how Ethereum derives
     *      addresses. The result is stable, collision-resistant in practice, and
     *      unspendable, which is what we want from a marker.
     */
    function markerAddress(bytes32 recipientHash) public pure returns (address) {
        return address(uint160(uint256(recipientHash)));
    }
}
