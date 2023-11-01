import {Block} from '@ethersproject/abstract-provider';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ethers} from 'hardhat';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
export const HOUR = 60 * 60;
export const DAY = HOUR * 24;

export const forceTime = async (timeElapsed = 15): Promise<void> => {
  const blockBefore = await ethers.provider.getBlock('latest');
  await ethers.provider.send('evm_mine', [blockBefore.timestamp + timeElapsed]);
};

export const getTime = async (): Promise<number> => {
  const block = await currentBlock();
  return block.timestamp;
};

export const setTime = async (timestamp: number): Promise<void> => {
  await ethers.provider.send('evm_mine', [timestamp]);
};

export const currentBlock = async (): Promise<Block> => {
  return await ethers.provider.getBlock('latest');
};

export const impersonate = async (
  hre: HardhatRuntimeEnvironment,
  account: string
): Promise<SignerWithAddress> => {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [account],
  });

  return await hre.ethers.getSigner(account);
};

export const resetFork = async (
  hre: HardhatRuntimeEnvironment,
  block?: number
): Promise<void> => {
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: block
      ? [
          {
            forking: {
              jsonRpcUrl: process.env.ARCHIVE_NODE_URL,
              blockNumber: block,
            },
          },
        ]
      : [],
  });
};
