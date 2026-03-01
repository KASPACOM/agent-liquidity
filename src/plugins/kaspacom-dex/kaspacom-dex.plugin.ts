import { type Chain, PluginBase } from "@goat-sdk/core";
import type { EVMWalletClient } from "@goat-sdk/wallet-evm";
import { KaspaComDexService } from "./kaspacom-dex.service";
import type { ChainConfig } from "./types";

// Supported chains configuration
const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // Kasplex Testnet
  167012: {
    chainId: 167012,
    chainName: "Kasplex Testnet",
    routerAddress: "0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e",
    factoryAddress: "0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E",
    wkasAddress: "0xf40178040278E16c8813dB20a84119A605812FB3",
    vaultAddress: "0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9",
  },
  // Galleon Testnet
  38836: {
    chainId: 38836,
    chainName: "IGRA Galleon Testnet",
    routerAddress: "0x81Cc4e7DbC652ec9168Bc2F4435C02d7F315148e",
    factoryAddress: "0x89d5842017ceA7dd18D10EE6c679cE199d2aD99E",
    wkasAddress: "0xf40178040278E16c8813dB20a84119A605812FB3",
    vaultAddress: "0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9",
  },
  // Add Kasplex Mainnet and Galleon Mainnet when deployed
};

export class KaspaComDexPlugin extends PluginBase<EVMWalletClient> {
  constructor(customConfig?: Partial<ChainConfig>) {
    const config = customConfig?.chainId
      ? { ...CHAIN_CONFIGS[customConfig.chainId], ...customConfig }
      : CHAIN_CONFIGS[167012]; // Default to Kasplex Testnet

    super("kaspacom-dex", [new KaspaComDexService(config as ChainConfig)]);
  }

  supportsChain = (chain: Chain) => {
    return chain.type === "evm" && Object.keys(CHAIN_CONFIGS).includes(chain.id.toString());
  };
}

export const kaspaComDex = (config?: Partial<ChainConfig>) => new KaspaComDexPlugin(config);
