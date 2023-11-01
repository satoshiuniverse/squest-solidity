import {execFileSync} from 'child_process';
import {BigNumber} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {task} from 'hardhat/config';
import path from 'path';
import {
  getConfig,
  getContract,
  getSellingControllerDeployArgs,
} from '../deploy/utils';
import {SellingController} from '../typechain';

task(
  'SQ:disable-whitelist',
  'Disable whitelist for SellingController'
).setAction(async (args, hre) => {
  const sellingControllerAddress = await hre.deployments.get(
    'SellingController'
  );
  const sellingController = await getContract<SellingController>(
    sellingControllerAddress.address,
    'SellingController',
    hre
  );
  const tx = await sellingController.disableWhitelist();
  await tx.wait();
});

task(
  'SQ:stop-selling',
  'Stop the selling period for SellingController'
).setAction(async (args, hre) => {
  const sellingControllerAddress = await hre.deployments.get(
    'SellingController'
  );
  const sellingController = await getContract<SellingController>(
    sellingControllerAddress.address,
    'SellingController',
    hre
  );
  const tx = await sellingController.forceStopSelling();
  await tx.wait();
});

task(
  'SQ:etherscan-verify-selling-controller',
  'Verify SellingController on Etherscan'
).setAction(async (args, hre) => {
  const sellingControllerAddress = await hre.deployments.get(
    'SellingController'
  );
  const deploymentArgs = await getSellingControllerDeployArgs(hre);
  await hre.run('verify:verify', {
    address: sellingControllerAddress.address,
    constructorArguments: deploymentArgs,
  });
});

task(
  'SQ:etherscan-verify-game-controller',
  'Verify GameController on Etherscan'
).setAction(async (args, hre) => {
  const [deployer] = await hre.ethers.getSigners();
  const gameControllerAddress = await hre.deployments.get('GameController');
  const p1 = {
    price: parseEther('0.08'),
    threshold: BigNumber.from('6000'),
  };
  const chainId = await hre.getChainId();
  const config = getConfig(chainId);
  const cardBackURI =
    'bafkreicxupvfclrjasxqxncbhdbctql5zgfwllp7x3yrp5ccrgl6m52bzm';
  await hre.run('verify:verify', {
    address: gameControllerAddress.address,
    constructorArguments: [
      cardBackURI,
      [p1],
      config.VAULT_PUBLIC_KEY,
      deployer.address, // Deployer set also as the maintainer
    ],
  });
});

task(
  'SQ:whitelist-parser',
  'Parse the whitelist CSV into a known file structure'
)
  .addParam(
    'input',
    'The CSV filepath from which the whitelist data mapping should be read'
  )
  .setAction(async (args, hre) => {
    const {input} = args;
    const chainId = await hre.getChainId();
    const executable = path.resolve(
      `${__dirname}/../scripts/whitelist-parser/target/release/`,
      'whitelist-parser'
    );
    const output = path.resolve(
      `${__dirname}/whitelist-raw/whitelist-raw-${chainId}.json`
    );
    const inputFormatted = path.resolve(input);
    execFileSync(executable, ['--input', inputFormatted, '--output', output]);
    console.log('Output written to', output);
  });

export {};
