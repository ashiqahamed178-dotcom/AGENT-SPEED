// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentSpend escrow
/// @notice Holds ERC-20 payments between a buyer and a seller, with a neutral
/// arbiter for disputes. These are the same rules as the AgentSpend backend.
/// @dev The contract has no owner and can't be upgraded, so nobody, including
/// its deployer, can take the funds outside these rules. The AI is not part of
/// this contract. It can only advise the people who call it.
contract AgentSpendEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Delivered,
        Disputed,
        Released,
        Refunded,
        Split
    }

    struct Deal {
        address buyer;
        address seller;
        address arbiter;
        IERC20 token;
        uint256 amount;
        uint64 deliveryDeadline;
        uint64 reviewDeadline;
        uint64 arbiterDeadline;
        Status status;
        bytes32 agreementHash;
        bytes32 evidenceHash;
    }

    /// @notice How long the buyer has to respond after delivery.
    uint64 public constant REVIEW_PERIOD = 7 days;

    /// @notice How long the arbiter has to decide a dispute.
    uint64 public constant ARBITER_PERIOD = 30 days;

    uint256 public dealCount;
    mapping(uint256 dealId => Deal) private _deals;

    event DealCreated(
        uint256 indexed dealId,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        address token,
        uint256 amount,
        uint64 deliveryDeadline,
        bytes32 agreementHash
    );
    event DeliverySubmitted(uint256 indexed dealId, bytes32 evidenceHash, uint64 reviewDeadline);
    event DisputeRaised(uint256 indexed dealId, address indexed raisedBy, uint64 arbiterDeadline);
    event Released(uint256 indexed dealId, address indexed triggeredBy, uint256 amount);
    event Refunded(uint256 indexed dealId, address indexed triggeredBy, uint256 amount);
    event SplitAfterTimeout(uint256 indexed dealId, uint256 buyerAmount, uint256 sellerAmount);

    error InvalidParties();
    error InvalidToken();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidHash();
    error UnsupportedToken();
    error NotAuthorized();
    error InvalidStatus(Status current);
    error TooEarly(uint64 availableAfter);
    error TooLate(uint64 deadline);

    modifier onlyStatus(uint256 dealId, Status expected) {
        Status current = _deals[dealId].status;
        if (current != expected) revert InvalidStatus(current);
        _;
    }

    /// @notice Creates a deal and moves the buyer's tokens into escrow in one step.
    /// @dev The buyer must approve this contract for `amount` first.
    /// @param agreementHash keccak256 of the agreement text, proving which text was agreed.
    function createDeal(
        address seller,
        address arbiter,
        IERC20 token,
        uint256 amount,
        uint64 deliveryDeadline,
        bytes32 agreementHash
    ) external nonReentrant returns (uint256 dealId) {
        // A party can't also be the arbiter, or they could decide their own dispute.
        if (
            seller == address(0) ||
            arbiter == address(0) ||
            seller == msg.sender ||
            arbiter == msg.sender ||
            arbiter == seller
        ) revert InvalidParties();
        if (address(token).code.length == 0) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        if (deliveryDeadline <= block.timestamp) revert InvalidDeadline();
        if (agreementHash == bytes32(0)) revert InvalidHash();

        dealId = ++dealCount;

        Deal storage deal = _deals[dealId];
        deal.buyer = msg.sender;
        deal.seller = seller;
        deal.arbiter = arbiter;
        deal.token = token;
        deal.amount = amount;
        deal.deliveryDeadline = deliveryDeadline;
        deal.status = Status.Funded;
        deal.agreementHash = agreementHash;

        // Tokens that take a fee on transfer would leave this contract holding
        // less than it owes, so they are refused.
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balanceBefore != amount) revert UnsupportedToken();

        emit DealCreated(
            dealId,
            msg.sender,
            seller,
            arbiter,
            address(token),
            amount,
            deliveryDeadline,
            agreementHash
        );
    }

    /// @notice The seller records delivery. This starts the buyer's review period.
    function submitDelivery(
        uint256 dealId,
        bytes32 evidenceHash
    ) external onlyStatus(dealId, Status.Funded) {
        Deal storage deal = _deals[dealId];
        if (msg.sender != deal.seller) revert NotAuthorized();
        if (block.timestamp > deal.deliveryDeadline) revert TooLate(deal.deliveryDeadline);
        if (evidenceHash == bytes32(0)) revert InvalidHash();

        deal.status = Status.Delivered;
        deal.evidenceHash = evidenceHash;
        deal.reviewDeadline = uint64(block.timestamp) + REVIEW_PERIOD;

        emit DeliverySubmitted(dealId, evidenceHash, deal.reviewDeadline);
    }

    /// @notice The buyer accepts the delivery and pays the seller.
    function release(uint256 dealId) external nonReentrant onlyStatus(dealId, Status.Delivered) {
        Deal storage deal = _deals[dealId];
        if (msg.sender != deal.buyer) revert NotAuthorized();

        _payOut(dealId, deal, deal.seller, Status.Released);
    }

    /// @notice The seller voluntarily returns the money to the buyer.
    function refund(uint256 dealId) external nonReentrant {
        Deal storage deal = _deals[dealId];
        if (deal.status != Status.Funded && deal.status != Status.Delivered) {
            revert InvalidStatus(deal.status);
        }
        if (msg.sender != deal.seller) revert NotAuthorized();

        _payOut(dealId, deal, deal.buyer, Status.Refunded);
    }

    /// @notice Either party stops the normal flow and asks the arbiter to decide.
    function dispute(uint256 dealId) external {
        Deal storage deal = _deals[dealId];
        if (deal.status != Status.Funded && deal.status != Status.Delivered) {
            revert InvalidStatus(deal.status);
        }
        if (msg.sender != deal.buyer && msg.sender != deal.seller) revert NotAuthorized();

        deal.status = Status.Disputed;
        deal.arbiterDeadline = uint64(block.timestamp) + ARBITER_PERIOD;

        emit DisputeRaised(dealId, msg.sender, deal.arbiterDeadline);
    }

    /// @notice The arbiter decides a dispute. The money can only go to the buyer
    /// or the seller, never to the arbiter.
    function resolve(
        uint256 dealId,
        bool payBuyer
    ) external nonReentrant onlyStatus(dealId, Status.Disputed) {
        Deal storage deal = _deals[dealId];
        if (msg.sender != deal.arbiter) revert NotAuthorized();

        if (payBuyer) {
            _payOut(dealId, deal, deal.buyer, Status.Refunded);
        } else {
            _payOut(dealId, deal, deal.seller, Status.Released);
        }
    }

    /// @notice The buyer takes the money back if the seller never delivered.
    function claimRefundAfterDeadline(
        uint256 dealId
    ) external nonReentrant onlyStatus(dealId, Status.Funded) {
        Deal storage deal = _deals[dealId];
        if (msg.sender != deal.buyer) revert NotAuthorized();
        if (block.timestamp <= deal.deliveryDeadline) revert TooEarly(deal.deliveryDeadline);

        _payOut(dealId, deal, deal.buyer, Status.Refunded);
    }

    /// @notice The seller gets paid if the buyer doesn't respond during the review period.
    function claimPaymentAfterReview(
        uint256 dealId
    ) external nonReentrant onlyStatus(dealId, Status.Delivered) {
        Deal storage deal = _deals[dealId];
        if (msg.sender != deal.seller) revert NotAuthorized();
        if (block.timestamp <= deal.reviewDeadline) revert TooEarly(deal.reviewDeadline);

        _payOut(dealId, deal, deal.seller, Status.Released);
    }

    /// @notice If the arbiter never decides, either party can split the money
    /// equally, so funds can't stay locked forever.
    /// @dev An odd smallest unit goes to the seller, so no tokens stay stuck.
    function splitAfterArbiterTimeout(
        uint256 dealId
    ) external nonReentrant onlyStatus(dealId, Status.Disputed) {
        Deal storage deal = _deals[dealId];
        if (msg.sender != deal.buyer && msg.sender != deal.seller) revert NotAuthorized();
        if (block.timestamp <= deal.arbiterDeadline) revert TooEarly(deal.arbiterDeadline);

        uint256 buyerAmount = deal.amount / 2;
        uint256 sellerAmount = deal.amount - buyerAmount;

        deal.status = Status.Split;

        emit SplitAfterTimeout(dealId, buyerAmount, sellerAmount);

        deal.token.safeTransfer(deal.buyer, buyerAmount);
        deal.token.safeTransfer(deal.seller, sellerAmount);
    }

    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return _deals[dealId];
    }

    /// @dev The status changes before tokens move, so a malicious token calling
    /// back in finds the deal already closed.
    function _payOut(uint256 dealId, Deal storage deal, address to, Status finalStatus) private {
        deal.status = finalStatus;

        if (finalStatus == Status.Released) {
            emit Released(dealId, msg.sender, deal.amount);
        } else {
            emit Refunded(dealId, msg.sender, deal.amount);
        }

        deal.token.safeTransfer(to, deal.amount);
    }
}
