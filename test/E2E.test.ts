// Load dependencies
import {JsonRpcProvider} from '@ethersproject/providers';
import {parseEther} from '@ethersproject/units';
import axios, {AxiosError} from 'axios';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import dotenv from 'dotenv';
import {solidity} from 'ethereum-waffle';
import {BigNumber, Signer} from 'ethers';
import {readFile} from 'fs/promises';
import hre, {ethers, network} from 'hardhat';
import {EthereumProvider} from 'hardhat/types';
import {
  DockerComposeEnvironment,
  GenericContainer,
  StartedTestContainer,
} from 'testcontainers';
import {getConfig, getContract} from '../deploy/utils';
import {FinalProofMapping} from '../scripts/cards/initial-shuffle';
import {GameController} from '../typechain/GameController';
import {NFT} from '../typechain/NFT';
import {SellingController} from '../typechain/SellingController';
import {forceTime} from './helper/utils';
// inject domain specific assertion methods
chai.use(solidity);
chai.use(chaiAsPromised);

const env = dotenv.config();

const cardsToBuy = 80;

// This is just a development storage key. well it is a real key, it's
// just that it will never point to something in production!
const TEST_NFT_STORAGE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkaWQ6ZXRocjoweEFhOEZDODIyOUZiM2Q5N0M2MWM3YkY2ZTE5MDA5MThGRDNmNTFlZjgiLCJpc3MiOiJuZnQtc3RvcmFnZSIsImlhdCI6MTYyNzI4NDM3MDEyMSwibmFtZSI6IlNhdG9zaGlRdWVzdCJ9.aPH5gsiCWwFi2SFuCQTxYCYOxsOtbY6VhOi5Lm6t9_M';

// Envelope
export type ApiResponse<T> = {
  msg: string;
  data: T;
};

// Skipping tests on `yarn coverage`, because there's some trickery necessary,
// to force it to use our custom hardhat Docker provider. Tackle later...
describe.skip('E2E Game Controller [ @skip-on-coverage ]', function () {
  let gameController: GameController;
  let sellingController: SellingController;
  let nft: NFT;
  let anotherUser: Signer; // Whitelisted for phase one
  let resProofsObject: FinalProofMapping;
  let hhNodeInstance: StartedTestContainer;
  let oldProvider: JsonRpcProvider;
  let oldProviderHRE: EthereumProvider;

  const buyCards = async (
    count: number,
    phasePrice: BigNumber,
    address: Signer
  ) => {
    const tx = {
      to: sellingController.address,
      value: phasePrice.mul(count),
    };
    const tr = await address.sendTransaction(tx);
    await tr.wait();
    return tr;
  };

  // Skip E2E tests inside the GitlabPipelines
  if (!process.env.GITLAB_CI) {
    afterEach(function () {
      // Set back the original ethers provider
      ethers.provider = oldProvider;
      hre.network.provider = oldProviderHRE;
    });

    beforeEach(async function () {
      // We will override ethers.provider later on. Store the old one.
      oldProvider = ethers.provider;
      oldProviderHRE = hre.network.provider;
      // Set timeout of 10 minutes. It may take quite a while to construct all the Docker containers and generate the images...
      this.timeout(720_000);

      // ----------------- Instantiate the backend ----------------- //
      const hhNodePort = 8544;
      hhNodeInstance = await new GenericContainer('hh-node-local')
        .withExposedPorts(hhNodePort)
        .start();
      const hhNodeIp = hhNodeInstance.getIpAddress(
        hhNodeInstance.getNetworkNames()[0]
      );
      // Connect to the spawned node instance (and override ethers.provider - it even works...)
      ethers.provider = new JsonRpcProvider(
        `http://${hhNodeIp}:${hhNodePort}`,
        31337
      );
      hre.network.provider = ethers.provider as unknown as EthereumProvider;
      [, anotherUser] = await ethers.getSigners();
      // Deploy Selling controller
      // Deploy sellingController and NFT
      {
        await hre.run('deploy', {tags: 'stage-1:local'});
        const sellingControllerAddress = (
          await hre.deployments.get('SellingController')
        ).address;
        sellingController = await getContract<SellingController>(
          sellingControllerAddress,
          'SellingController',
          hre
        );
        nft = await getContract<NFT>(
          await sellingController.nftToken(),
          'NFT',
          hre
        );
        const tx = await sellingController.disableWhitelist();
        // Buy 10 cards
        await tx.wait();
      }

      // Force time to a period when we can actually buy the cards
      {
        const config = getConfig(network.config.chainId!.toString());
        await forceTime(config.SELLING_LAUNCH);
      }

      // Buy 10 cards
      await buyCards(cardsToBuy, parseEther('0.08'), anotherUser);
      await buyCards(cardsToBuy, parseEther('0.08'), anotherUser);

      // Deploy GameController and Chainlink
      {
        await hre.run('deploy', {tags: 'stage-2:local'});
        const gameControllerAddress = (
          await hre.deployments.get('GameController')
        ).address;
        gameController = await getContract<GameController>(
          gameControllerAddress,
          'GameController',
          hre
        );
      }

      // Generate proofs and put the game controller in charge
      await hre.run('deploy', {tags: 'stage-3:local'});
      const basePathOutput = `${__dirname}/../tasks/generated/${network.config.chainId?.toString()}/${
        gameController.address
      }`;
      resProofsObject = JSON.parse(
        await readFile(`${basePathOutput}/gen_card_info_proofs.json`, 'utf-8')
      );

      // Start trading game
      await new DockerComposeEnvironment(__dirname, 'docker-compose.test.yml')
        // Will be exposed via 127.0.0.1:5003
        .withEnv('SERVER_HOST', '127.0.0.1')
        .withEnv('SERVER_PORT', '5003')

        .withEnv('RUST_LOG', 'debug')
        .withEnv('SECRET_RECAPTCHA_V2_SECRET', '')
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .withEnv('SECRET_DO_SPACES_KEY', env.parsed!.DO_SPACES_KEY)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .withEnv('SECRET_DO_SPACES_SECRET', env.parsed!.DO_SPACES_SECRETKEY)
        .withEnv(
          'SECRET_MAINTAINER_PRIVATE_KEY',
          // hardhat mnemonics 2nd account. it's used as the maintainer on local net.
          '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
        )
        .withEnv('SECRET_NFT_STORAGE_KEY', TEST_NFT_STORAGE_KEY)
        .withEnv('CONFIG_IGNORE_RECAPTCHA', 'true') // Ignoring recaptcha for tests
        .withEnv('CONFIG_NODE_URL', `http://${hhNodeIp}:${hhNodePort}`)
        .withEnv('CONFIG_SELLING_CONTROLLER_ADDRESS', sellingController.address)
        .withEnv('CONFIG_GAME_CONTROLLER_ADDRESS', gameController.address)
        .withEnv('CONFIG_BLOCK_DELTA', '1')
        .withEnv('CONFIG_HIDE_ENDING', 'true')
        .withEnv('CONFIG_DO_SPACES_REGION', 'fra1')
        .withEnv('CONFIG_DO_SPACES_NAME', 'sq-static')
        .withEnv('CONFIG_DO_SPACES_SUBFOLDER', 'test')
        .withEnv('DB_PORT', '5432')
        .withEnv('DB_NAME', 'sq')
        .withEnv('DB_HOST', '127.0.0.1')
        .withEnv('DB_USER', 'root')
        .withEnv('DB_PASSWORD', 'password')
        .up();
      let doBreak = false;
      while (!doBreak) {
        // Wait for the server to start up.

        await axios.get('http://127.0.0.1:5003').catch((e: AxiosError) => {
          // 404 gets returned on root url when the server starts up
          if (e.response?.status === 404) {
            doBreak = true;
          }
        });
      }
    });
    it('E2E Reveal and upgrade card', async function () {
      // Set timeout of 1 minute. It may take quite a while to construct all the Docker containers...
      this.timeout(720_000);
      // Collect all cards
      const allTokenIds = [];
      for (const user of [anotherUser]) {
        const cardOwnerAddress = await user.getAddress();
        const totalTokensForUser = (
          await nft.balanceOf(cardOwnerAddress)
        ).toNumber();
        for (let index = 0; index < totalTokensForUser; index++) {
          const tokenId = (
            await nft.tokenOfOwnerByIndex(cardOwnerAddress, index)
          ).toNumber();
          allTokenIds.push(tokenId);
        }
      }

      // Card revealing
      {
        for (const tokenId of allTokenIds) {
          const proof = resProofsObject[tokenId].merkleProof;
          const ipfsUri = resProofsObject[tokenId].ipfsUri;
          const dna = resProofsObject[tokenId].dna;

          // Before reveal
          await expect(gameController.getDna(tokenId)).to.eventually.equal(0);
          const defaultCardCid = await nft.getDefaultCID();
          await expect(nft.tokenURI(tokenId)).to.eventually.equal(
            `ipfs://${defaultCardCid}`
          );

          // After reveal
          console.log('revealing', tokenId, ipfsUri, dna);
          const tx = await gameController
            .connect(anotherUser)
            .revealCard(proof, tokenId, ipfsUri, dna);
          await tx.wait();

          await expect(
            gameController.connect(anotherUser).getDna(tokenId)
          ).to.eventually.equal(dna);

          await expect(
            nft.connect(anotherUser).tokenURI(tokenId)
          ).to.eventually.equal(`ipfs://${ipfsUri}`);
        }
      }

      // Card upgrading
      {
        let doBreak = false;
        for (const tokenIdToUpgrade of allTokenIds) {
          // O^2 here I come!
          for (const tokenIdDonor of allTokenIds) {
            if (doBreak) break;
            if (tokenIdToUpgrade === tokenIdDonor) continue;
            const message = await axios.get<ApiResponse<{message: string}>>(
              `http://127.0.0.1:5003/upgrades/normal/message`,
              {
                params: {
                  tokenIdToUpgrade,
                  tokenIdDonor,
                },
              }
            );
            const signedMessage = await anotherUser.signMessage(
              message.data.data.message
            );
            await axios
              .post<
                ApiResponse<{
                  signedMessage: string;
                  tokenUpgraded: number;
                  tokenTwo: number;
                  newDna: number;
                  newIpfs: string;
                }>
              >('http://127.0.0.1:5003/upgrades/normal', {
                tokenIdToUpgrade,
                tokenIdDonor,
                signedMessage: signedMessage,
                recaptchaToken: 'this-is-ignored',
              })
              .then(async (upgradeResultEnvelope) => {
                console.log(
                  'Backend can upgrade',
                  tokenIdToUpgrade,
                  'with',
                  tokenIdDonor
                );
                const upgradeResult = upgradeResultEnvelope.data.data;
                // Make sure we're not upgrading to the same ID we already have
                expect(
                  resProofsObject[upgradeResult.tokenUpgraded].dna !==
                    upgradeResult.newDna
                );

                await gameController
                  .connect(anotherUser)
                  .upgradeCard(upgradeResult.signedMessage, {
                    primaryCardId: upgradeResult.tokenUpgraded,
                    secondaryCardId: upgradeResult.tokenTwo,
                    newDna: upgradeResult.newDna,
                    newCID: upgradeResult.newIpfs,
                  });

                // The main card gets upgraded
                await expect(
                  gameController.getDna(upgradeResult.tokenUpgraded)
                ).to.eventually.equal(
                  BigNumber.from(upgradeResult.newDna),
                  'DNA not matching for the upgraded card'
                );
                await expect(
                  nft.tokenURI(upgradeResult.tokenUpgraded)
                ).to.eventually.equal(`ipfs://${upgradeResult.newIpfs}`);

                // The donor card not altered
                await expect(
                  gameController.getDna(upgradeResult.tokenTwo)
                ).to.eventually.equal(
                  resProofsObject[upgradeResult.tokenTwo].dna,
                  'DNA has been updated for donor card'
                );
                await expect(
                  nft.tokenURI(upgradeResult.tokenTwo)
                ).to.eventually.equal(
                  `ipfs://${resProofsObject[upgradeResult.tokenTwo].ipfsUri}`
                );
                // After we've validated at least a single card, we know that conceptually the signatures work. no reason tot est further
                doBreak = true;
              })
              .catch(() => {
                console.log(
                  'Cannot upgrade',
                  tokenIdToUpgrade,
                  'with',
                  tokenIdDonor
                );
                // ignore cases where backend cannot upgrade cards
              });
          }
        }
        expect(doBreak).to.equal(true, 'No cards got upgraded!');
      }

      // Find satoshi
      {
        // find all lvl 4 cards
        // Start cross matching all of them with one another
        // const allLevel4Cards =
        const idDnaTuple = await Promise.all(
          allTokenIds.map(async (id) => {
            const dna = await gameController.getDna(id);
            return [id, dna.toNumber()];
          })
        );
        // Note: this is ctrl+c ctrl+v from the card gen code.
        // Consequent DNA schema updates from the backend must also be represented here!
        const LEVEL_BIT_MASK =
          BigNumber.from(0b0000_11_0000_000_0000_0000_000000000000000_0000);
        const level4Cards = idDnaTuple.filter(([, dna]) => {
          const dnaBig = BigNumber.from(dna);
          return dnaBig.and(LEVEL_BIT_MASK).eq(LEVEL_BIT_MASK);
        });
        const HERO_BITS =
          BigNumber.from(0b1111_00_0000_000_0000_0000_000000000000000_0000);
        const FREAK_BITS =
          BigNumber.from(0b0000_00_0000_000_0000_0000_000000000000000_0000);
        const GEEK_BITS =
          BigNumber.from(0b0001_00_0000_000_0000_0000_000000000000000_0000);
        const HACKER_BITS =
          BigNumber.from(0b0010_00_0000_000_0000_0000_000000000000000_0000);
        const SLACKER_BITS =
          BigNumber.from(0b0011_00_0000_000_0000_0000_000000000000000_0000);

        const level4Freaks = level4Cards.filter(([, dna]) => {
          const dnaBig = BigNumber.from(dna);
          return dnaBig.and(HERO_BITS).eq(FREAK_BITS);
        });
        const level4Slackers = level4Cards.filter(([, dna]) => {
          const dnaBig = BigNumber.from(dna);
          return dnaBig.and(HERO_BITS).eq(SLACKER_BITS);
        });
        const level4Hackers = level4Cards.filter(([, dna]) => {
          const dnaBig = BigNumber.from(dna);
          return dnaBig.and(HERO_BITS).eq(HACKER_BITS);
        });
        const level4Geeks = level4Cards.filter(([, dna]) => {
          const dnaBig = BigNumber.from(dna);
          return dnaBig.and(HERO_BITS).eq(GEEK_BITS);
        });

        const results: Array<GrandResponse> = [];
        for (const [freaksCardId] of level4Freaks) {
          for (const [slackersCardId] of level4Slackers) {
            for (const [hackersCardId] of level4Hackers) {
              for (const [geeksCardId] of level4Geeks) {
                const message = await axios.get<ApiResponse<{message: string}>>(
                  `http://127.0.0.1:5003/upgrades/grand/message`,
                  {
                    params: {
                      freakCardId: freaksCardId,
                      geekCardId: geeksCardId,
                      slackerCardId: slackersCardId,
                      hackerCardId: hackersCardId,
                    },
                  }
                );
                const signedMessage = await anotherUser.signMessage(
                  message.data.data.message
                );
                await axios
                  .post<ApiResponse<GrandResponse>>(
                    'http://127.0.0.1:5003/upgrades/grand',
                    {
                      freakCardId: freaksCardId,
                      geekCardId: geeksCardId,
                      slackerCardId: slackersCardId,
                      hackerCardId: hackersCardId,
                      signedMessage: signedMessage,
                      recaptchaToken: 'this-is-ignored',
                    }
                  )
                  .then((a) => {
                    results.push(a.data.data);
                    console.log(
                      'FOUND SOMETHING',
                      freaksCardId,
                      geeksCardId,
                      slackersCardId,
                      hackersCardId,
                      a.data.data.newCards
                    );
                  })
                  .catch(() => {
                    console.log(
                      'Cannot do grand upgrade',
                      freaksCardId,
                      geeksCardId,
                      slackersCardId,
                      hackersCardId
                    );
                    // ignore cases where backend cannot upgrade cards
                  });
              }
            }
          }
        }

        expect(results.length >= 3).to.equal(
          true,
          'the given card set must result in at least 3 endings'
        );

        // Filter for unique
        const flattenedDnas = results.reduce((acc: Array<number>, curr) => {
          const dnas = curr.newCards.map((e) => e.newDna);
          return acc.concat(dnas);
        }, []);
        const onlyUniqueDnas = flattenedDnas.filter(
          (e, index) => flattenedDnas.indexOf(e) === index
        );
        expect(onlyUniqueDnas.length === 4).to.equal(
          true,
          'Must contain only 4 total result cards'
        );

        const alreadyStoreDnas: Array<string> = [];
        let newCardId = (await nft.totalSupply()).toNumber();
        for (const backendResponse of results) {
          const cardCids = backendResponse.newCards.map((e) => e.newIpfs);
          const cardDnas = backendResponse.newCards.map((e) => e.newDna);

          const dnaCombo = backendResponse.newCards.map((e) => e.newDna).join();
          if (alreadyStoreDnas.includes(dnaCombo)) {
            await expect(
              gameController
                .connect(anotherUser)
                .findSatoshi(backendResponse.signedMessage, {
                  freakCardId: backendResponse.freakCardId,
                  geekCardId: backendResponse.geekCardId,
                  hackerCardId: backendResponse.hackerCardId,
                  slackerCardId: backendResponse.slackerCardId,
                  newCardsCids: cardCids,
                  newCardsDnas: cardDnas,
                })
            ).to.be.revertedWith('This ending has already been revealed!');
          } else {
            await gameController
              .connect(anotherUser)
              .findSatoshi(backendResponse.signedMessage, {
                freakCardId: backendResponse.freakCardId,
                geekCardId: backendResponse.geekCardId,
                hackerCardId: backendResponse.hackerCardId,
                slackerCardId: backendResponse.slackerCardId,
                newCardsCids: cardCids,
                newCardsDnas: cardDnas,
              });

            let localOffset = 1;
            for (const cardToMint of backendResponse.newCards) {
              const thisTokenId = newCardId + localOffset;
              // The main card gets upgraded
              await expect(
                gameController.getDna(thisTokenId)
              ).to.eventually.equal(
                BigNumber.from(cardToMint.newDna),
                'DNA not matching for the upgraded card'
              );
              await expect(nft.tokenURI(thisTokenId)).to.eventually.equal(
                `ipfs://${cardToMint.newIpfs}`
              );
              localOffset += 1;
            }
            newCardId += backendResponse.newCards.length;
            alreadyStoreDnas.push(dnaCombo);
          }
        }
      }
    });
  }
});

interface GrandResponse {
  signedMessage: string;
  freakCardId: number;
  geekCardId: number;
  slackerCardId: number;
  hackerCardId: number;
  newCards: Array<GrandCardResponse>;
}

interface GrandCardResponse {
  newDna: number;
  newIpfs: string;
}
