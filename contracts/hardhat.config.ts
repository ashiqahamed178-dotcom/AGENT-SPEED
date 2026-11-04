import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Base Sepolia is a free test network. Its money has no value.
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: "https://sepolia.base.org",
      accounts: [configVariable("TESTNET_PRIVATE_KEY")],
    },
  },
});
