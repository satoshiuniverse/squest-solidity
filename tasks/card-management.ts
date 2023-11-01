import {existsSync} from 'fs';
import {mkdir, readFile} from 'fs/promises';
import {task} from 'hardhat/config';
import path from 'path';
import {GenericContainer} from 'testcontainers';
import {getContract} from '../deploy/utils';
import {
  FinalProofMapping,
  generateMerkleTree,
} from '../scripts/cards/initial-shuffle';
import {GameController, NFT, SellingController} from '../typechain';

task('SQ:initial-shuffle-gen', 'Generate SatoshiQuest card upgrade proofs')
  .addParam(
    'basePath',
    `the base path where to output files in form of :
      - \`<basePathOutput>/gen_cards_with_proof.json\`
      - \`<basePathOutput>/merkle_root.txt\`
    The new folders will be created automatically.
    `
  )
  .addParam(
    'nftStorageKey',
    'The API key to use to connect to https://nft.storage'
  )
  .addParam('doSpacesKey', 'The API key to use DigitalOcean spaces')
  .addParam(
    'doSpacesSecretKey',
    'The secret API key to use DigitalOcean spaces'
  )
  .addParam('doSpacesRegion', 'The DigitalOcean spaces region')
  .addParam('doSpacesName', 'The DigitalOcean spaces name')
  .addParam('doSpacesSubfolder', 'The DigitalOcean spaces subfolder')
  .addParam('hideCards', 'Disable all card images, (hidden cards)')
  .setAction(async (args, hre) => {
    const {
      basePath,
      nftStorageKey,
      doSpacesKey,
      doSpacesSecretKey,
      doSpacesRegion,
      doSpacesName,
      hideCards,
      doSpacesSubfolder,
    } = args;

    const gameControllerAddress = await hre.deployments.get('GameController');
    const gameController = await getContract<GameController>(
      gameControllerAddress.address,
      'GameController',
      hre
    );

    const sellingControllerAddress = await hre.deployments.get(
      'SellingController'
    );
    const sellingController = await getContract<SellingController>(
      sellingControllerAddress.address,
      'SellingController',
      hre
    );

    const nft = await getContract<NFT>(
      await sellingController.nftToken(),
      'NFT',
      hre
    );

    // Generate proofs
    const chainId = await hre.getChainId();
    await mkdir(basePath, {recursive: true});
    console.log('Generating mappings into: ', basePath, '...');
    const totalTokens = (await nft.totalSupply()).toNumber();
    const randomResult = (await gameController.randomResult()).toHexString();
    await new GenericContainer('sq-initial-shuffle:latest')
      .withBindMount(basePath, '/app/artifacts', 'rw')
      .withEnv('SHUFFLE_TOTAL_TOKENS', totalTokens.toString())
      .withEnv('SHUFFLE_CHAIN_ID', chainId.toString())
      .withEnv('SHUFFLE_GAME_CONTROLLER_ADDRESS', gameControllerAddress.address)
      .withEnv('SHUFFLE_RANDOM_NUMBER', randomResult)
      .withEnv('SHUFFLE_NFT_STORAGE_KEY', nftStorageKey)
      .withEnv('SHUFFLE_OUTPUT_PATH', 'artifacts')
      .withEnv('SHUFFLE_DO_SPACES_KEY', doSpacesKey)
      .withEnv('SHUFFLE_DO_SPACES_SECRET', doSpacesSecretKey)
      .withEnv('SHUFFLE_DO_SPACES_REGION', doSpacesRegion)
      .withEnv('SHUFFLE_DO_SPACES_NAME', doSpacesName)
      .withEnv('SHUFFLE_ONLY_DNAS', 'false')
      .withEnv('SHUFFLE_BLUR_ENDING', hideCards)
      .withEnv('SHUFFLE_DO_SPACES_SUBFOLDER', doSpacesSubfolder)
      .start();

    const proofMappingLocation = path.resolve(basePath, 'gen_card_info.json');
    while (!existsSync(proofMappingLocation)) {
      /* Blocking, waiting for file to be created */
    }
    const proofMappingLocationWithProofs = path.resolve(
      basePath,
      'gen_card_info_proofs.json'
    );
    const tree = await generateMerkleTree(
      proofMappingLocation,
      proofMappingLocationWithProofs
    );
    console.log('Proof mapping constructed', proofMappingLocationWithProofs);

    const proofMapping: FinalProofMapping = JSON.parse(
      await readFile(proofMappingLocationWithProofs, 'utf-8')
    );
    console.log(`Merkle root: ${tree.tree.getHexRoot()}`);
    console.log(`Proof mapping location: ${proofMappingLocation}`);
    return [tree.tree.getHexRoot(), proofMapping];
  });

task(
  'SQ:dna-gen',
  'Generate the initial DNAs for a given set of token IDs'
).setAction(async (args, hre) => {
  const sellingControllerAddress = await hre.deployments.get(
    'SellingController'
  );
  const sellingController = await getContract<SellingController>(
    sellingControllerAddress.address,
    'SellingController',
    hre
  );
  if (!(await sellingController.isSellingStopped())) {
    console.log('Selling must be stopped before DNAs can be generated!');
    return;
  }

  const gameControllerAddress = await hre.deployments.get('GameController');
  const chainId = await hre.getChainId();
  const basePath_ = `${__dirname}/generated/`;
  const basePath = path.resolve(
    basePath_,
    `${chainId.toString()}/${gameControllerAddress.address}`
  );

  const nft = await getContract<NFT>(
    await sellingController.nftToken(),
    'NFT',
    hre
  );
  const totalTokens = (await nft.totalSupply()).toNumber();

  // Generate DNA
  await mkdir(basePath, {recursive: true});
  console.log('Generating DNA list into: ', basePath, '...');
  await new GenericContainer('sq-initial-shuffle:latest')
    .withBindMount(basePath, '/app/artifacts', 'rw')
    .withEnv('SHUFFLE_TOTAL_TOKENS', totalTokens.toString())
    .withEnv('SHUFFLE_CHAIN_ID', chainId.toString())
    .withEnv('SHUFFLE_ONLY_DNAS', 'true')
    .withEnv('SHUFFLE_OUTPUT_PATH', 'artifacts')
    .start();
});

export {};
