import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("AgentSpendEscrow", (m) => {
  const escrow = m.contract("AgentSpendEscrow");
  const testUsdc = m.contract("TestUSDC");

  return { escrow, testUsdc };
});
