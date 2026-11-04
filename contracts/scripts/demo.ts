// Runs one complete deal on a temporary local blockchain: npm run demo
// Paste an agreement fingerprint from the app to use the real one:
//   npm run demo -- 0xabc...
import { network } from "hardhat";
import { formatUnits, keccak256, parseUnits, stringToHex } from "viem";

const fingerprint = process.argv.find((value) => /^0x[0-9a-fA-F]{64}$/.test(value));
const agreementHash =
  (fingerprint as `0x${string}` | undefined) ??
  keccak256(stringToHex("Seller delivers a website with a login system."));

const { viem, networkHelpers } = await network.create();
const [buyer, seller, arbiter] = await viem.getWalletClients();

const escrow = await viem.deployContract("AgentSpendEscrow");
const usdc = await viem.deployContract("TestUSDC");
const amount = parseUnits("500", 6);
const show = async (who: { account: { address: `0x${string}` } }) =>
  formatUnits(await usdc.read.balanceOf([who.account.address]), 6);

await usdc.write.mint([buyer.account.address, amount]);
await usdc.write.approve([escrow.address, amount], { account: buyer.account });

const deadline = BigInt(await networkHelpers.time.latest()) + 7n * 86_400n;

await escrow.write.createDeal(
  [seller.account.address, arbiter.account.address, usdc.address, amount, deadline, agreementHash],
  { account: buyer.account }
);

const id = await escrow.read.dealCount();
const deal = await escrow.read.getDeal([id]);

console.log(`Contract:           ${escrow.address}`);
console.log(`Agreement on-chain: ${deal.agreementHash}`);
console.log(`Escrow holds:       ${formatUnits(await usdc.read.balanceOf([escrow.address]), 6)} tUSDC`);

await escrow.write.submitDelivery([id, keccak256(stringToHex("Delivered the website."))], {
  account: seller.account,
});
console.log("Seller submitted delivery.");

await escrow.write.release([id], { account: buyer.account });

console.log("Buyer accepted and released payment.");
console.log(`Seller now holds:   ${await show(seller)} tUSDC`);
console.log(`Arbiter holds:      ${await show(arbiter)} tUSDC`);
