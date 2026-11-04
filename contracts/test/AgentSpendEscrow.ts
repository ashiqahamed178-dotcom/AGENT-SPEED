import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, parseUnits, stringToHex, zeroAddress, zeroHash } from "viem";

const { viem, networkHelpers } = await network.create();
const { time } = networkHelpers;

const AMOUNT = parseUnits("500", 6);
const AGREEMENT = keccak256(stringToHex("Seller delivers a website by the deadline."));
const EVIDENCE = keccak256(stringToHex("Source code and deployment link."));
const DAY = 24n * 60n * 60n;

const Status = { Funded: 1, Delivered: 2, Disputed: 3, Released: 4, Refunded: 5, Split: 6 };

describe("AgentSpendEscrow", () => {
  let buyer: any;
  let seller: any;
  let arbiter: any;
  let stranger: any;
  let escrow: any;
  let usdc: any;

  const as = (client: any) => ({ account: client.account });

  const expectError = (call: Promise<unknown>, name: string) =>
    viem.assertions.revertWithCustomError(call, escrow, name);

  async function deadline(days = 7n) {
    return BigInt(await time.latest()) + days * DAY;
  }

  async function createDeal(amount = AMOUNT) {
    await escrow.write.createDeal(
      [seller.account.address, arbiter.account.address, usdc.address, amount, await deadline(), AGREEMENT],
      as(buyer)
    );
    return await escrow.read.dealCount();
  }

  async function deliveredDeal() {
    const id = await createDeal();
    await escrow.write.submitDelivery([id, EVIDENCE], as(seller));
    return id;
  }

  async function disputedDeal() {
    const id = await createDeal();
    await escrow.write.dispute([id], as(buyer));
    return id;
  }

  const balance = (client: any) => usdc.read.balanceOf([client.account.address]);
  const statusOf = async (id: bigint) => (await escrow.read.getDeal([id])).status;

  beforeEach(async () => {
    [buyer, seller, arbiter, stranger] = await viem.getWalletClients();
    escrow = await viem.deployContract("AgentSpendEscrow");
    usdc = await viem.deployContract("TestUSDC");

    await usdc.write.mint([buyer.account.address, parseUnits("10000", 6)]);
    await usdc.write.approve([escrow.address, parseUnits("10000", 6)], as(buyer));
  });

  describe("createDeal", () => {
    it("moves the tokens into escrow and records the deal", async () => {
      const before = await balance(buyer);
      const id = await createDeal();
      const deal = await escrow.read.getDeal([id]);

      assert.equal(await balance(buyer), before - AMOUNT);
      assert.equal(await usdc.read.balanceOf([escrow.address]), AMOUNT);
      assert.equal(deal.status, Status.Funded);
      assert.equal(deal.buyer, getAddress(buyer.account.address));
      assert.equal(deal.seller, getAddress(seller.account.address));
      assert.equal(deal.agreementHash, AGREEMENT);
    });

    it("emits an event", async () => {
      const when = await deadline();
      await viem.assertions.emit(
        escrow.write.createDeal(
          [seller.account.address, arbiter.account.address, usdc.address, AMOUNT, when, AGREEMENT],
          as(buyer)
        ),
        escrow,
        "DealCreated"
      );
    });

    it("refuses invalid parties", async () => {
      const when = await deadline();
      const b = buyer.account.address;
      const s = seller.account.address;
      const a = arbiter.account.address;

      for (const [sellerAddress, arbiterAddress] of [
        [zeroAddress, a],
        [s, zeroAddress],
        [b, a], // buyer as seller
        [s, b], // buyer as arbiter
        [s, s], // seller as arbiter
      ]) {
        await expectError(
          escrow.write.createDeal(
            [sellerAddress, arbiterAddress, usdc.address, AMOUNT, when, AGREEMENT],
            as(buyer)
          ),
          "InvalidParties"
        );
      }
    });

    it("refuses bad values", async () => {
      const when = await deadline();
      const s = seller.account.address;
      const a = arbiter.account.address;

      await expectError(
        escrow.write.createDeal([s, a, usdc.address, 0n, when, AGREEMENT], as(buyer)),
        "InvalidAmount"
      );
      await expectError(
        escrow.write.createDeal([s, a, usdc.address, AMOUNT, 1n, AGREEMENT], as(buyer)),
        "InvalidDeadline"
      );
      await expectError(
        escrow.write.createDeal([s, a, usdc.address, AMOUNT, when, zeroHash], as(buyer)),
        "InvalidHash"
      );
      await expectError(
        escrow.write.createDeal([s, a, stranger.account.address, AMOUNT, when, AGREEMENT], as(buyer)),
        "InvalidToken"
      );
    });

    it("refuses a token that takes a fee on transfer", async () => {
      const feeToken = await viem.deployContract("FeeToken");
      await feeToken.write.mint([buyer.account.address, AMOUNT]);
      await feeToken.write.approve([escrow.address, AMOUNT], as(buyer));

      await expectError(
        escrow.write.createDeal(
          [seller.account.address, arbiter.account.address, feeToken.address, AMOUNT, await deadline(), AGREEMENT],
          as(buyer)
        ),
        "UnsupportedToken"
      );
    });

    it("keeps separate deals separate", async () => {
      const first = await createDeal(parseUnits("100", 6));
      const second = await createDeal(parseUnits("200", 6));

      await escrow.write.refund([first], as(seller));

      assert.equal(await statusOf(second), Status.Funded);
      assert.equal(await usdc.read.balanceOf([escrow.address]), parseUnits("200", 6));
    });
  });

  describe("normal flow", () => {
    it("pays the seller when the buyer accepts", async () => {
      const id = await deliveredDeal();
      const deal = await escrow.read.getDeal([id]);

      assert.equal(deal.evidenceHash, EVIDENCE);
      assert.equal(deal.status, Status.Delivered);

      await escrow.write.release([id], as(buyer));

      assert.equal(await balance(seller), AMOUNT);
      assert.equal(await statusOf(id), Status.Released);
      assert.equal(await usdc.read.balanceOf([escrow.address]), 0n);
    });

    it("only lets the seller submit delivery", async () => {
      const id = await createDeal();

      await expectError(escrow.write.submitDelivery([id, EVIDENCE], as(buyer)), "NotAuthorized");
      await expectError(escrow.write.submitDelivery([id, EVIDENCE], as(stranger)), "NotAuthorized");
    });

    it("refuses delivery after the deadline, or without evidence", async () => {
      const id = await createDeal();

      await expectError(escrow.write.submitDelivery([id, zeroHash], as(seller)), "InvalidHash");

      await time.increase(8n * DAY);
      await expectError(escrow.write.submitDelivery([id, EVIDENCE], as(seller)), "TooLate");
    });

    it("only lets the buyer release, and only after delivery", async () => {
      const funded = await createDeal();
      await expectError(escrow.write.release([funded], as(buyer)), "InvalidStatus");

      const delivered = await deliveredDeal();
      await expectError(escrow.write.release([delivered], as(seller)), "NotAuthorized");
      await expectError(escrow.write.release([delivered], as(arbiter)), "NotAuthorized");
      await expectError(escrow.write.release([delivered], as(stranger)), "NotAuthorized");
    });

    it("can't pay out twice", async () => {
      const id = await deliveredDeal();
      await escrow.write.release([id], as(buyer));

      await expectError(escrow.write.release([id], as(buyer)), "InvalidStatus");
      await expectError(escrow.write.refund([id], as(seller)), "InvalidStatus");
      await expectError(escrow.write.dispute([id], as(buyer)), "InvalidStatus");
      assert.equal(await balance(seller), AMOUNT);
    });

    it("lets only the seller give a voluntary refund", async () => {
      const id = await createDeal();
      const before = await balance(buyer);

      await expectError(escrow.write.refund([id], as(buyer)), "NotAuthorized");

      await escrow.write.refund([id], as(seller));

      assert.equal(await balance(buyer), before + AMOUNT);
      assert.equal(await statusOf(id), Status.Refunded);
    });
  });

  describe("disputes", () => {
    it("lets the arbiter refund the buyer", async () => {
      const id = await disputedDeal();
      const before = await balance(buyer);

      await escrow.write.resolve([id, true], as(arbiter));

      assert.equal(await balance(buyer), before + AMOUNT);
      assert.equal(await statusOf(id), Status.Refunded);
    });

    it("lets the arbiter pay the seller", async () => {
      const id = await disputedDeal();

      await escrow.write.resolve([id, false], as(arbiter));

      assert.equal(await balance(seller), AMOUNT);
      assert.equal(await statusOf(id), Status.Released);
    });

    it("never pays the arbiter", async () => {
      const id = await disputedDeal();

      await escrow.write.resolve([id, false], as(arbiter));

      assert.equal(await balance(arbiter), 0n);
    });

    it("doesn't let either party decide their own dispute", async () => {
      const id = await disputedDeal();

      await expectError(escrow.write.resolve([id, true], as(buyer)), "NotAuthorized");
      await expectError(escrow.write.resolve([id, false], as(seller)), "NotAuthorized");
      await expectError(escrow.write.resolve([id, true], as(stranger)), "NotAuthorized");
    });

    it("only lets the parties raise a dispute", async () => {
      const id = await createDeal();

      await expectError(escrow.write.dispute([id], as(stranger)), "NotAuthorized");
      await expectError(escrow.write.dispute([id], as(arbiter)), "NotAuthorized");

      await escrow.write.dispute([id], as(seller));
      assert.equal(await statusOf(id), Status.Disputed);
    });

    it("freezes the normal flow during a dispute", async () => {
      const id = await deliveredDeal();
      await escrow.write.dispute([id], as(seller));

      await expectError(escrow.write.release([id], as(buyer)), "InvalidStatus");
      await expectError(escrow.write.refund([id], as(seller)), "InvalidStatus");
    });

    it("won't resolve a deal that isn't in dispute", async () => {
      const id = await createDeal();

      await expectError(escrow.write.resolve([id, true], as(arbiter)), "InvalidStatus");
    });
  });

  describe("timeouts", () => {
    it("refunds the buyer if the seller never delivers", async () => {
      const id = await createDeal();
      const before = await balance(buyer);

      await expectError(escrow.write.claimRefundAfterDeadline([id], as(buyer)), "TooEarly");

      await time.increase(8n * DAY);

      await expectError(escrow.write.claimRefundAfterDeadline([id], as(seller)), "NotAuthorized");

      await escrow.write.claimRefundAfterDeadline([id], as(buyer));

      assert.equal(await balance(buyer), before + AMOUNT);
    });

    it("pays the seller if the buyer never responds", async () => {
      const id = await deliveredDeal();

      await expectError(escrow.write.claimPaymentAfterReview([id], as(seller)), "TooEarly");

      await time.increase(8n * DAY);

      await expectError(escrow.write.claimPaymentAfterReview([id], as(buyer)), "NotAuthorized");

      await escrow.write.claimPaymentAfterReview([id], as(seller));

      assert.equal(await balance(seller), AMOUNT);
    });

    it("stops the seller's claim if the buyer disputes in time", async () => {
      const id = await deliveredDeal();
      await escrow.write.dispute([id], as(buyer));

      await time.increase(8n * DAY);

      await expectError(escrow.write.claimPaymentAfterReview([id], as(seller)), "InvalidStatus");
    });

    it("splits the money if the arbiter never decides", async () => {
      const odd = parseUnits("100", 6) + 1n;
      const id = await createDeal(odd);
      await escrow.write.dispute([id], as(buyer));
      const buyerBefore = await balance(buyer);

      await expectError(escrow.write.splitAfterArbiterTimeout([id], as(seller)), "TooEarly");

      await time.increase(31n * DAY);

      await expectError(escrow.write.splitAfterArbiterTimeout([id], as(stranger)), "NotAuthorized");

      await escrow.write.splitAfterArbiterTimeout([id], as(seller));

      assert.equal(await balance(buyer), buyerBefore + odd / 2n);
      assert.equal(await balance(seller), odd - odd / 2n);
      assert.equal(await usdc.read.balanceOf([escrow.address]), 0n);
      assert.equal(await statusOf(id), Status.Split);
    });

    it("lets a late arbiter still decide if nobody has split yet", async () => {
      const id = await disputedDeal();

      await time.increase(31n * DAY);

      await escrow.write.resolve([id, false], as(arbiter));

      assert.equal(await balance(seller), AMOUNT);
    });
  });

  describe("attacks", () => {
    it("blocks a token that calls back in to take the money twice", async () => {
      const evil = await viem.deployContract("ReentrantToken");
      await evil.write.mint([buyer.account.address, AMOUNT * 2n]);
      await evil.write.approve([escrow.address, AMOUNT * 2n], as(buyer));

      const create = async () => {
        await escrow.write.createDeal(
          [seller.account.address, arbiter.account.address, evil.address, AMOUNT, await deadline(), AGREEMENT],
          as(buyer)
        );
        return await escrow.read.dealCount();
      };

      const first = await create();
      await create();

      await escrow.write.submitDelivery([first, EVIDENCE], as(seller));
      await evil.write.arm([escrow.address, first]);
      await escrow.write.release([first], as(buyer));

      assert.equal(await evil.read.attackAttempted(), true);
      assert.equal(await evil.read.attackSucceeded(), false);
      assert.equal(await evil.read.balanceOf([seller.account.address]), AMOUNT);
      assert.equal(await evil.read.balanceOf([escrow.address]), AMOUNT);
    });

    it("rejects unknown deal ids", async () => {
      await expectError(escrow.write.release([999n], as(buyer)), "InvalidStatus");
      await expectError(escrow.write.refund([999n], as(seller)), "InvalidStatus");
    });
  });
});
