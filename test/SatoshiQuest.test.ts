// Load dependencies
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {solidity} from 'ethereum-waffle';
import {BigNumber, Wallet} from 'ethers';
import {TypedDataUtils} from 'ethers-eip712';
import {
  getContractAddress,
  joinSignature,
  keccak256,
  solidityPack,
} from 'ethers/lib/utils';
import {promises} from 'fs';
import hre, {ethers, network} from 'hardhat';
import {
  FinalProofMapping,
  generateMerkleTree,
} from '../scripts/cards/initial-shuffle';
import {MerkleTree} from '../scripts/MerkleTree/merkle-tree';
import {FinalWhitelistProofMapping} from '../tasks/whitelist-management';
import {NFT__factory, SellingController__factory} from '../typechain';
import {FailedGame} from '../typechain/FailedGame';
import {FailedGameV2} from '../typechain/FailedGameV2';
import {FailedGameV3} from '../typechain/FailedGameV3';
import {GameController} from '../typechain/GameController';
import {LinkToken} from '../typechain/LinkToken';
import {NFT} from '../typechain/NFT';
import {SellingController} from '../typechain/SellingController';
import {VRFCoordinatorMock} from '../typechain/VRFCoordinatorMock';
import {forceTime, getTime} from './helper/utils';
// inject domain specific assertion methods
chai.use(solidity);
chai.use(chaiAsPromised);

const phaseOnePrice = BigNumber.from('150000000000000000');
const phaseTwoPrice = BigNumber.from('200000000000000000');
const phaseThreePrice = BigNumber.from('300000000000000000');

// Chainlink
const keyHash =
  '0x6c3699283bda56ad74f6b855546325b68d482e983852a7a82979cc4807b641f4';
const pricePerLink = BigNumber.from('2000000000000000000');
const p1 = {price: phaseOnePrice, threshold: 10};
const p2 = {price: phaseTwoPrice, threshold: 20};
const p3 = {price: phaseThreePrice, threshold: 30};

const WHITELIST_CAP = BigNumber.from('100000');

type MerkleTreeItem = {address: string; cap: number; partner: boolean};

async function cleanupAndCreateTestWhitelist(
  items: MerkleTreeItem[],
  deployer: SignerWithAddress
): Promise<[string, FinalWhitelistProofMapping, BigNumber]> {
  // Calculate the address of the selling controller
  const sellingControllerAddress = getContractAddress({
    from: deployer.address,
    nonce: await deployer.getTransactionCount(),
  });

  // Clean up old files
  // console.log('removing old files');
  const pathBase = `/tmp/artifacts-whitelist/${network.config.chainId?.toString()}/${sellingControllerAddress}`;
  await promises.rm(pathBase, {recursive: true, force: true});

  // Create new dir
  // console.log('creating dir');
  await promises.mkdir(pathBase, {recursive: true});

  // Write test file
  const testPath = `${pathBase}/whitelist-base.json`;
  // console.log('creating file');
  await promises.writeFile(testPath, JSON.stringify({addresses: items}));

  const testPathOutput = `${pathBase}/merkle-tree-item.json`;
  const whitelistRoot: string = await hre.run('SQ:address-whitelist', {
    whitelistInput: testPath,
    proofOutput: testPathOutput,
    silent: true,
    sellingControllerAddress,
  });
  // Read the proofs
  const proofs: FinalWhitelistProofMapping = JSON.parse(
    await promises.readFile(testPathOutput, 'utf-8')
  );
  const caps = Object.values(proofs).map((e) => e.cap);
  const maxCap = BigNumber.from(caps.length ? Math.max(...caps) : 0);
  // TODO use `getSellingControllerDeployArgs(hre)`

  return [whitelistRoot, proofs, maxCap];
}

describe('Satoshi Quest Tests', function () {
  let gameController: GameController;
  let sellingController: SellingController;
  let nft: NFT;
  let linkToken: LinkToken;
  let vrfCoordinator: VRFCoordinatorMock;
  let owner: SignerWithAddress;
  let anotherUser: SignerWithAddress; // Whitelisted for phase one
  let anotherUser2: SignerWithAddress; // Whitelisted for phase one
  let anotherUser3: SignerWithAddress; // Whitelisted for phase one
  let anotherUser4: SignerWithAddress;
  let partner: SignerWithAddress;
  let maintainer: SignerWithAddress;
  let vault: SignerWithAddress; // Default Recipient for ether transfers
  let gameControllerMaintainer: Wallet;
  let whitelistRoot: string;
  let proofs: FinalWhitelistProofMapping;
  let maxCap: BigNumber;

  const buyCards = async (
    count: number,
    phasePrice: BigNumber,
    signer: SignerWithAddress,
    controller = sellingController
  ) => {
    const tx = {
      to: controller.address,
      value: phasePrice.mul(count),
    };
    return await signer.sendTransaction(tx);
  };
  const buyCardsWhenWhitelisted = async (
    count: number,
    phasePrice: BigNumber,
    signer: SignerWithAddress,
    controller = sellingController,
    partner = false
  ) => {
    let specificProofs: Array<Buffer> = [];
    let cap = 0;
    if (proofs[signer.address]) {
      specificProofs = proofs[signer.address].merkleProof.map((e) =>
        Buffer.from(e.slice(2), 'hex')
      );
      cap = proofs[signer.address].cap;
    }
    return await controller
      .connect(signer)
      .buyCards(specificProofs, cap, partner, {
        value: phasePrice.mul(count),
      });
  };

  beforeEach(async function () {
    [
      owner,
      anotherUser,
      anotherUser2,
      anotherUser3,
      anotherUser4,
      vault,
      maintainer,
      partner,
    ] = await ethers.getSigners();
    gameControllerMaintainer = ethers.Wallet.createRandom();

    // Deploy sellingController and NFT
    {
      const sellingControllerFactory = await ethers.getContractFactory(
        'SellingController'
      );
      [whitelistRoot, proofs, maxCap] = await cleanupAndCreateTestWhitelist(
        [
          {address: anotherUser.address, cap: 30, partner: false},
          {address: anotherUser2.address, cap: 30, partner: false},
          {address: anotherUser3.address, cap: 30, partner: false},
        ],
        owner
      );
      sellingController = (await sellingControllerFactory.deploy(
        'hash-of-cardback-on-ipfs',
        [p1, p2, p3],
        vault.address,
        maintainer.address,
        owner.address,
        maxCap,
        WHITELIST_CAP,
        whitelistRoot,
        0
      )) as SellingController;
      await sellingController.deployed();

      // Set nft
      const nftFactory = await ethers.getContractFactory('NFT');
      nft = nftFactory.attach(await sellingController.nftToken()) as NFT;
    }
    // Deploy gamecontroller and Chainlink
    {
      // ------ Start: Mock VrfCoordinator ------
      const linkTokenFactory = await ethers.getContractFactory('LinkToken');
      linkToken = (await linkTokenFactory.deploy()) as LinkToken;
      const chainlinkVrfCoordinatorFactory = await ethers.getContractFactory(
        'VRFCoordinatorMock'
      );
      vrfCoordinator = (await chainlinkVrfCoordinatorFactory.deploy(
        linkToken.address
      )) as VRFCoordinatorMock;
      // ------ END: Mock VrfCoordinator ------
      const gameControllerFactory = await ethers.getContractFactory(
        'GameController'
      );
      gameController = (await gameControllerFactory.deploy(
        nft.address,
        sellingController.address,
        {
          vrfCoordinator: vrfCoordinator.address,
          link: linkToken.address,
          keyHash,
          fee: pricePerLink,
        },
        gameControllerMaintainer.address
      )) as GameController;
      await gameController.deployed();
    }
  });

  describe('NFT meta-data', function () {
    beforeEach(async function () {
      // Buy cards for the initial user
      await buyCardsWhenWhitelisted(5, phaseOnePrice, anotherUser);

      await expect(nft.balanceOf(anotherUser.address)).to.eventually.equal('5');
    });

    it('Name correct', async function () {
      expect(await nft.name()).to.equal('SatoshiQuest');
      expect(await nft.symbol()).to.equal('SQG');

      // https://ethereum.stackexchange.com/a/62538
      const erc721 = '0x80ac58cd';
      expect(await nft.supportsInterface(erc721)).to.equal(true);
    });

    it('Card URLs after minting', async function () {
      const tx = await buyCardsWhenWhitelisted(25, phaseOnePrice, anotherUser);

      await expect(nft.totalSupply()).to.eventually.equal('30');
      for (let cardIndex = 6; cardIndex <= 30; cardIndex++) {
        await expect(tx)
          .to.emit(nft, 'URIUpdated')
          .withArgs(cardIndex.toString(), 'hash-of-cardback-on-ipfs');
      }

      for (let cardIndex = 1; cardIndex <= 30; cardIndex++) {
        await expect(nft.ownerOf(cardIndex)).to.eventually.equal(
          anotherUser.address
        );
        await expect(nft.tokenURI(cardIndex)).to.eventually.equal(
          'ipfs://hash-of-cardback-on-ipfs'
        );
      }
    });
  });

  describe('Selling controller', function () {
    describe('when whitelist cap is 100 000', () => {
      it('Only single phase', async function () {
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );

        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [
            {address: anotherUser.address, cap: 30, partner: false},
            {address: anotherUser2.address, cap: 30, partner: false},
            {address: anotherUser3.address, cap: 30, partner: false},
          ],
          owner
        );
        const contract = (await sellingControllerFactory.deploy(
          'ipfs://hash-of-cardback-on-ipfs',
          [p1],
          vault.address,
          owner.address, // `Owner` set as the maintainer,
          owner.address, // `Owner` set as the initial owner of NFT
          maxCap,
          WHITELIST_CAP,
          whitelistRoot,
          0
        )) as SellingController;
        await contract.deployed();

        sellingController = contract;
        await expect(sellingController.deployTransaction)
          .to.emit(sellingController, 'MaintenanceTransferred')
          .withArgs(
            '0x0000000000000000000000000000000000000000',
            owner.address
          );
        await expect(sellingController.deployTransaction)
          .to.emit(sellingController, 'NextPhaseStarted')
          .withArgs([p1.price, p1.threshold]);

        const tx = sellingController.connect(owner).disableWhitelist();
        await expect(tx).to.emit(sellingController, 'WhitelistDisabled');
        await expect(sellingController.getPhasePrice(0)).to.eventually.equal(
          phaseOnePrice
        );
        await expect(
          sellingController.getPhaseThreshold(0)
        ).to.eventually.equal(10);
        await expect(sellingController.getPhaseCount()).to.eventually.equal(1);
        await expect(sellingController.getPhasePrice(1)).to.be.revertedWith(
          'Exceeded phase length!'
        );
        await expect(sellingController.getPhaseThreshold(1)).to.be.revertedWith(
          'Exceeded phase length!'
        );
        // ---- Buy multiple cards ----
        const phaseOneTx = await buyCards(10, phaseOnePrice, anotherUser);
        await expect(phaseOneTx).to.emit(sellingController, 'SellingStopped');
      });

      it('Deployment event', async function () {
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );

        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [
            {address: anotherUser.address, cap: 30, partner: false},
            {address: anotherUser2.address, cap: 30, partner: false},
            {address: anotherUser3.address, cap: 30, partner: false},
          ],
          owner
        );
        const contract = (await sellingControllerFactory.deploy(
          'hash-of-cardback-on-ipfs',
          [p1, p2, p3],
          vault.address,
          maintainer.address,
          owner.address, // `owner` set as the initial owner of NFT
          maxCap,
          WHITELIST_CAP,
          whitelistRoot,
          0
        )) as SellingController;
        await contract.deployed();
        await expect(contract.deployTransaction)
          .to.emit(contract, 'NextPhaseStarted')
          .withArgs([p1.price, p1.threshold]);
      });

      it('Meta data', async function () {
        await expect(nft.getDefaultCID()).to.eventually.equal(
          'hash-of-cardback-on-ipfs'
        );
        await expect(sellingController.getMaintainer()).to.eventually.equal(
          maintainer.address,
          'Maintainer does not match'
        );

        await expect(
          sellingController.connect(owner).setMaintainer(owner.address)
        )
          .to.emit(sellingController, 'MaintenanceTransferred')
          .withArgs(maintainer.address, owner.address);
        await expect(sellingController.getMaintainer()).to.eventually.equal(
          owner.address,
          'Owner does not match'
        );

        await expect(sellingController.getPhasePrice(0)).to.eventually.equal(
          phaseOnePrice
        );
        await expect(sellingController.getPhasePrice(1)).to.eventually.equal(
          phaseTwoPrice
        );
        await expect(sellingController.getPhasePrice(2)).to.eventually.equal(
          phaseThreePrice
        );

        await expect(
          sellingController.getPhaseThreshold(0)
        ).to.eventually.equal(10);
        await expect(
          sellingController.getPhaseThreshold(1)
        ).to.eventually.equal(20);
        await expect(
          sellingController.getPhaseThreshold(2)
        ).to.eventually.equal(30);

        await expect(sellingController.getVault()).to.eventually.equal(
          vault.address
        );
        await expect(sellingController.getPhaseCount()).to.eventually.equal(3);
      });

      it('Starting the real game, stop selling', async function () {
        await buyCardsWhenWhitelisted(5, phaseOnePrice, anotherUser);
        {
          // Fill the consumer with LINK tokens
          await linkToken.transfer(
            gameController.address,
            pricePerLink.mul(10)
          );
        }

        await expect(
          sellingController
            .connect(maintainer)
            .startGame(gameController.address)
        ).to.be.revertedWith('Ownable: caller is not the owner');

        await expect(
          sellingController.connect(owner).startGame(gameController.address)
        ).to.be.revertedWith('Selling has not been stopped!');
        await sellingController.forceStopSelling();

        const failedGameImpl = await ethers.getContractFactory('FailedGame');
        const failedGameImplDeployed =
          (await failedGameImpl.deploy()) as FailedGame;

        await expect(
          sellingController
            .connect(owner)
            // Provide an address that does not implement IGameInterface
            .startGame(failedGameImplDeployed.address)
        ).to.be.revertedWith('Game cannot be started!');

        const failedGameImplV2 = await ethers.getContractFactory(
          'FailedGameV2'
        );
        const failedGameImplV2Deployed =
          (await failedGameImplV2.deploy()) as FailedGameV2;
        await expect(
          sellingController
            .connect(owner)
            // Provide an address that does not implement IDnaProvider
            .startGame(failedGameImplV2Deployed.address)
        ).to.be.revertedWith(
          'The game controller must implement `IDnaProvider`!'
        );

        const startTradingTx = await sellingController
          .connect(owner)
          .startGame(gameController.address);
        await expect(startTradingTx).to.emit(sellingController, 'GameStarted');

        {
          // Fulfill the randomness
          const requestId = await gameController.requestId();
          await vrfCoordinator.callBackWithRandomness(
            requestId,
            BigNumber.from('42'),
            gameController.address
          );
        }
        await expect(nft.owner()).to.eventually.equal(owner.address);
        await expect(nft.getController()).to.eventually.equal(
          gameController.address
        );
        await expect(gameController.randomResult()).to.eventually.equal(42);

        // Second time no longer works
        await expect(
          sellingController.connect(owner).startGame(gameController.address)
        ).to.be.revertedWith('Only the controller can access this method!'); // Cannot re-transfer the NFT controller
        // Cannot buy tokens
        await expect(
          buyCards(5, phaseOnePrice, anotherUser)
        ).to.be.revertedWith(
          'Selling has been stopped!' // Cannot buy new NFTs
        );
      });

      it('Disable whitelist', async function () {
        // Buy 3 cards as whitelisted
        await buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser);

        // Using the wrong method
        await expect(
          buyCards(3, phaseOnePrice, anotherUser4)
        ).to.be.revertedWith('Whitelist enabled: use `buyCards()`!');

        // Non-whitelisted cannot buy
        await expect(
          buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser4)
        ).to.be.revertedWith('Address is not on the whitelist!');

        // disable whitelist
        await expect(
          sellingController.connect(owner).disableWhitelist()
        ).to.be.revertedWith('Only the maintainer can access this method!');
        const tx = sellingController.connect(maintainer).disableWhitelist();
        await expect(tx).to.emit(sellingController, 'WhitelistDisabled');

        // Non-whitelisted can buy
        await buyCards(3, phaseOnePrice, anotherUser4);
        await expect(nft.totalSupply()).to.eventually.equal('6');
      });

      it('Accidental ERC20 transfer', async function () {
        // Transfer ERC20 tokens
        await linkToken.transfer(anotherUser2.address, 10);

        await linkToken
          .connect(anotherUser2)
          .transfer(sellingController.address, 8);

        await expect(
          linkToken.balanceOf(anotherUser2.address)
        ).to.eventually.equal('2');
        // Get the ERC20 tokens back
        await sellingController.recoverTokens(
          linkToken.address,
          anotherUser2.address,
          8
        );
        await expect(
          linkToken.balanceOf(anotherUser2.address)
        ).to.eventually.equal('10');
      });

      it('All phases separately, validate ether recipient.', async function () {
        const initialRecipientBalance = await vault.getBalance();
        // ------------------- Phase one -------------------
        // ---- Buy a single card ----
        await buyCardsWhenWhitelisted(1, phaseOnePrice, anotherUser);
        await expect(vault.getBalance()).to.eventually.equal(
          initialRecipientBalance.add(phaseOnePrice)
        );
        await expect(nft.totalSupply()).to.eventually.equal('1');
        await expect(nft.ownerOf(1)).to.eventually.equal(
          anotherUser.address,
          'Invalid ether recipient balance'
        );
        await expect(nft.tokenURI(1)).to.eventually.equal(
          'ipfs://hash-of-cardback-on-ipfs'
        );

        // ---- Buy multiple cards ----
        const phaseOneTx = await buyCardsWhenWhitelisted(
          9,
          phaseOnePrice,
          anotherUser
        );
        await expect(phaseOneTx)
          .to.emit(sellingController, 'NextPhaseStarted')
          .withArgs([p2.price, p2.threshold]);

        await expect(nft.totalSupply()).to.eventually.equal(10);
        for (let cardIndex = 1; cardIndex <= 10; cardIndex++) {
          await expect(nft.ownerOf(cardIndex)).to.eventually.equal(
            anotherUser.address
          );
          await expect(nft.tokenURI(cardIndex)).to.eventually.equal(
            'ipfs://hash-of-cardback-on-ipfs'
          );
        }
        await expect(vault.getBalance()).to.eventually.equal(
          initialRecipientBalance.add(phaseOnePrice.mul(10)),
          'Invalid ether recipient balance'
        );
        // ------------------- Phase two -------------------
        // ---- Leftover wei ----
        await expect(sellingController.phaseIndex()).to.eventually.equal(1);
        await expect(
          buyCardsWhenWhitelisted(1, phaseThreePrice, anotherUser)
        ).to.be.revertedWith('Leftover wei when buying cards, aborting!');

        // ---- Buy multiple cards ----
        const phaseTwoTx = await buyCardsWhenWhitelisted(
          10,
          phaseTwoPrice,
          anotherUser
        );
        await expect(phaseTwoTx)
          .to.emit(sellingController, 'NextPhaseStarted')
          .withArgs([p3.price, p3.threshold]);

        await expect(nft.totalSupply()).to.eventually.equal('20');
        for (let cardIndex = 10; cardIndex <= 20; cardIndex++) {
          await expect(nft.ownerOf(cardIndex)).to.eventually.equal(
            anotherUser.address
          );
          await expect(nft.tokenURI(cardIndex)).to.eventually.equal(
            'ipfs://hash-of-cardback-on-ipfs'
          );
        }
        // Change ether recipient.
        const anotherUser3InitialBalance = await anotherUser3.getBalance();
        await sellingController.setVault(anotherUser3.address);
        // disable whitelist
        await sellingController.connect(maintainer).disableWhitelist();

        // ------------------- Phase three -------------------
        // ---- Buy multiple cards ----
        await expect(
          buyCards(1, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Not enough funds!');
        const phaseThreeTx = await buyCards(10, phaseThreePrice, anotherUser);
        await expect(phaseThreeTx).to.emit(sellingController, 'SellingStopped');

        await expect(nft.totalSupply()).to.eventually.equal('30');
        for (let cardIndex = 20; cardIndex <= 30; cardIndex++) {
          await expect(nft.ownerOf(cardIndex)).to.eventually.equal(
            anotherUser.address
          );
          await expect(nft.tokenURI(cardIndex)).to.eventually.equal(
            'ipfs://hash-of-cardback-on-ipfs'
          );
        }
        await expect(anotherUser3.getBalance()).to.eventually.equal(
          anotherUser3InitialBalance.add(phaseThreePrice.mul(10)),
          'Invalid ether recipient balance'
        );
        // ------------------- Minting off -------------------
        await expect(
          buyCards(10, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Selling has been stopped!');
        await expect(sellingController.isSellingStopped()).to.eventually.equal(
          true
        );

        await expect(vault.getBalance()).to.eventually.equal(
          initialRecipientBalance
            .add(phaseOnePrice.mul(10))
            .add(phaseTwoPrice.mul(10)),
          'Invalid ether recipient balance'
        );
      });

      it('Transactions with whitelist', async function () {
        await buyCardsWhenWhitelisted(5, phaseOnePrice, anotherUser);
        await buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser);
        await buyCardsWhenWhitelisted(7, phaseOnePrice, anotherUser);
        await buyCardsWhenWhitelisted(5, phaseTwoPrice, anotherUser);
        await buyCardsWhenWhitelisted(10, phaseThreePrice, anotherUser);

        await expect(nft.totalSupply()).to.eventually.equal('30');
        for (let cardIndex = 1; cardIndex <= 30; cardIndex++) {
          await expect(nft.ownerOf(cardIndex)).to.eventually.equal(
            anotherUser.address
          );
          await expect(nft.tokenURI(cardIndex)).to.eventually.equal(
            'ipfs://hash-of-cardback-on-ipfs'
          );
        }
        // ------------------- Minting off -------------------
        await expect(
          buyCards(10, phaseTwoPrice, anotherUser)
        ).to.be.revertedWith('Selling has been stopped!');
        await expect(sellingController.isSellingStopped()).to.eventually.equal(
          true
        );
      });

      it('Disable minting period', async function () {
        // Buy couple of cards
        await buyCardsWhenWhitelisted(5, phaseOnePrice, anotherUser);
        await buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser);

        await expect(
          sellingController.connect(maintainer).forceStopSelling()
        ).to.be.revertedWith('Ownable: caller is not the owner');

        const tx = sellingController.connect(owner).forceStopSelling();
        await expect(tx).to.emit(sellingController, 'SellingStopped');

        await expect(
          buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Selling has been stopped!');
      });

      it('Access invalid getters', async function () {
        await expect(sellingController.getPhasePrice(3)).to.be.revertedWith(
          'Exceeded phase length!'
        );
      });

      it('Transactions without whitelist', async function () {
        await sellingController.connect(maintainer).disableWhitelist();
        await buyCards(5, phaseOnePrice, vault);
        await buyCards(3, phaseOnePrice, vault);
        await buyCards(7, phaseOnePrice, vault);
        await buyCards(5, phaseTwoPrice, vault);
        await buyCards(10, phaseThreePrice, vault);

        await expect(nft.totalSupply()).to.eventually.equal('30');
        for (let cardIndex = 1; cardIndex <= 30; cardIndex++) {
          await expect(nft.ownerOf(cardIndex)).to.eventually.equal(
            vault.address
          );
          await expect(nft.tokenURI(cardIndex)).to.eventually.equal(
            'ipfs://hash-of-cardback-on-ipfs'
          );
        }
        // ------------------- Minting off -------------------
        await expect(sellingController.isSellingStopped()).to.eventually.equal(
          true
        );
        await expect(
          buyCards(10, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Selling has been stopped!');
      });

      it('All phases as single transaction, try minting more than possible', async function () {
        await sellingController.connect(maintainer).disableWhitelist();

        await expect(
          buyCardsWhenWhitelisted(45, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Cannot buy more cards than total supply allows!');
        await expect(nft.totalSupply()).to.eventually.equal(0);
      });

      it('Multiple phase shifts: all phases as single transaction', async function () {
        const phaseOneTx = await buyCardsWhenWhitelisted(
          30,
          phaseOnePrice,
          anotherUser
        );
        await expect(phaseOneTx)
          .to.emit(sellingController, 'SellingStopped')
          .withArgs();

        await expect(nft.totalSupply()).to.eventually.equal(30);
        await expect(
          buyCardsWhenWhitelisted(1, phaseTwoPrice, anotherUser)
        ).to.be.revertedWith('Selling has been stopped!');
        await expect(sellingController.isSellingStopped()).to.eventually.equal(
          true
        );
      });

      it('Too many phases', async function () {
        const phases = [];
        for (let index = 0; index < 255; index++) {
          phases.push({price: phaseOnePrice, threshold: 10 + index});
        }
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );

        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [],
          owner
        );
        await expect(
          sellingControllerFactory.deploy(
            'hash-of-cardback-on-ipfs',
            phases,
            vault.address,
            maintainer.address,
            owner.address, // `owner` set as the initial owner of NFT
            maxCap,
            WHITELIST_CAP,
            whitelistRoot,
            0
          )
        ).to.be.revertedWith('Contract cannot handle this many phases!');
      });

      it('Inconsistent initial phases', async function () {
        const p1 = {price: phaseOnePrice, threshold: 10};
        const p2 = {price: phaseTwoPrice, threshold: 20};
        const p3 = {price: phaseThreePrice, threshold: 30};
        const p4Price = phaseThreePrice.add(phaseOnePrice);
        const p4 = {price: p4Price, threshold: 40};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );
        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [],
          owner
        );
        await expect(
          sellingControllerFactory.deploy(
            'hash-of-cardback-on-ipfs',
            [p1, p3, p2, p4], //NOTE: p2 and p3 are swapped
            vault.address,
            maintainer.address,
            owner.address, // `owner` set as the initial owner of NFT
            maxCap,
            WHITELIST_CAP,
            whitelistRoot,
            0
          )
        ).to.be.revertedWith(
          'Phase thresholds must be consequentially incrementing!'
        );
      });

      it('NFT gets correctly transferred', async function () {
        const p1 = {price: phaseOnePrice, threshold: 10};
        const p2 = {price: phaseTwoPrice, threshold: 20};
        const p3 = {price: phaseThreePrice, threshold: 30};
        const p4Price = phaseThreePrice.add(phaseOnePrice);
        const p4 = {price: p4Price, threshold: 40};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );
        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [],
          owner
        );
        const sellingController = await sellingControllerFactory.deploy(
          'hash-of-cardback-on-ipfs',
          [p1, p2, p3, p4],
          vault.address,
          maintainer.address,
          anotherUser.address, // `anotherUser` set as the initial owner of NFT
          maxCap,
          WHITELIST_CAP,
          whitelistRoot,
          0
        );

        const nftFactory = await ethers.getContractFactory('NFT');
        nft = nftFactory.attach(await sellingController.nftToken()) as NFT;
        await expect(nft.owner()).to.eventually.equal(anotherUser.address);
      });

      it('Invalid maintainer', async function () {
        const p1 = {price: phaseOnePrice, threshold: 10};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );

        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [],
          owner
        );
        await expect(
          sellingControllerFactory.deploy(
            'hash-of-cardback-on-ipfs',
            [p1],
            vault.address,
            '0x0000000000000000000000000000000000000000',
            owner.address, // `owner` set as the initial owner of NFT
            maxCap,
            WHITELIST_CAP,
            whitelistRoot,
            0
          )
        ).to.be.revertedWith('Invalid maintainer address!');
      });

      it('Invalid vault', async function () {
        const p1 = {price: phaseOnePrice, threshold: 10};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );

        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [],
          owner
        );
        await expect(
          sellingControllerFactory.deploy(
            'hash-of-cardback-on-ipfs',
            [p1],
            '0x0000000000000000000000000000000000000000',
            maintainer.address,
            owner.address, // `owner` set as the initial owner of NFT
            maxCap,
            WHITELIST_CAP,
            whitelistRoot,
            0
          )
        ).to.be.revertedWith('Invalid vault address!');
      });

      it('Multiple phase shifts', async function () {
        const p1 = {price: phaseOnePrice, threshold: 10};
        const p2 = {price: phaseTwoPrice, threshold: 20};
        const p3 = {price: phaseThreePrice, threshold: 30};
        const p4Price = phaseThreePrice.add(phaseOnePrice);
        const p4 = {price: p4Price, threshold: 40};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );

        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [
            {address: anotherUser.address, cap: 30, partner: false},
            {address: anotherUser2.address, cap: 30, partner: false},
            {address: anotherUser3.address, cap: 30, partner: false},
          ],
          owner
        );
        sellingController = (await sellingControllerFactory.deploy(
          'hash-of-cardback-on-ipfs',
          [p1, p2, p3, p4],
          vault.address,
          maintainer.address,
          owner.address, // `owner` set as the initial owner of NFT
          maxCap,
          WHITELIST_CAP,
          whitelistRoot,
          0
        )) as SellingController;
        await sellingController.deployed();
        await sellingController.connect(maintainer).disableWhitelist();
        const txBuy = await buyCards(35, phaseOnePrice, anotherUser);
        await expect(txBuy)
          .to.emit(sellingController, 'NextPhaseStarted')
          .withArgs([p2.price, p2.threshold]);
        await expect(txBuy)
          .to.emit(sellingController, 'NextPhaseStarted')
          .withArgs([p3.price, p3.threshold]);

        await expect(sellingController.phaseIndex()).to.eventually.equal(3);
        const tx = await buyCards(5, p4Price, anotherUser);
        await expect(tx)
          .to.emit(sellingController, 'SellingStopped')
          .withArgs();
        await expect(sellingController.phaseIndex()).to.eventually.equal(4);
      });

      it('Multiple phase shifts v2', async function () {
        const p1 = {price: phaseOnePrice, threshold: 10};
        const p2 = {price: phaseTwoPrice, threshold: 20};
        const p3 = {price: phaseThreePrice, threshold: 30};
        const p4Price = phaseThreePrice.add(phaseOnePrice);
        const p4 = {price: p4Price, threshold: 40};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );

        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [
            {address: anotherUser.address, cap: 30, partner: false},
            {address: anotherUser2.address, cap: 30, partner: false},
            {address: anotherUser3.address, cap: 30, partner: false},
          ],
          owner
        );
        sellingController = (await sellingControllerFactory.deploy(
          'hash-of-cardback-on-ipfs',
          [p1, p2, p3, p4],
          vault.address,
          maintainer.address,
          owner.address, // `owner` set as the initial owner of NFT
          maxCap,
          WHITELIST_CAP,
          whitelistRoot,
          0
        )) as SellingController;
        await sellingController.deployed();
        await sellingController.connect(maintainer).disableWhitelist();
        await buyCards(30, phaseOnePrice, anotherUser);

        await expect(sellingController.phaseIndex()).to.eventually.equal(3);
        const tx = await buyCards(10, p4Price, anotherUser);
        await expect(tx)
          .to.emit(sellingController, 'SellingStopped')
          .withArgs();
        await expect(sellingController.phaseIndex()).to.eventually.equal(4);
      });

      it('Invalid max cap', async function () {
        const p1 = {price: phaseOnePrice, threshold: 30};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );
        [whitelistRoot, proofs, maxCap] = await cleanupAndCreateTestWhitelist(
          [{address: anotherUser.address, cap: 10, partner: false}],
          owner
        );
        sellingController = (await sellingControllerFactory.deploy(
          'hash-of-cardback-on-ipfs',
          [p1],
          vault.address,
          maintainer.address,
          owner.address, // `owner` set as the initial owner of NFT
          2, // Incorrectly set the `maxCap`, ignoring the ones that's actually present in the merkle tree.
          WHITELIST_CAP,
          whitelistRoot,
          0
        )) as SellingController;
        await sellingController.deployed();
        await expect(
          buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Whitelist cap exceeds the max allowed one!');
      });

      it('Multiple phase shifts v3', async function () {
        const p1 = {price: phaseOnePrice, threshold: 10};
        const p2 = {price: phaseTwoPrice, threshold: 20};
        const p3 = {price: phaseThreePrice, threshold: 30};
        const p4Price = phaseThreePrice.add(phaseOnePrice);
        const p4 = {price: p4Price, threshold: 40};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );
        const [whitelistRoot, , maxCap] = await cleanupAndCreateTestWhitelist(
          [
            {address: anotherUser.address, cap: 10, partner: false},
            {address: anotherUser2.address, cap: 10, partner: false},
            {address: anotherUser3.address, cap: 10, partner: false},
          ],
          owner
        );
        sellingController = (await sellingControllerFactory.deploy(
          'hash-of-cardback-on-ipfs',
          [p1, p2, p3, p4],
          vault.address,
          maintainer.address,
          owner.address, // `owner` set as the initial owner of NFT
          maxCap,
          WHITELIST_CAP,
          whitelistRoot,
          0
        )) as SellingController;
        await sellingController.deployed();
        const tx1 = await sellingController
          .connect(maintainer)
          .disableWhitelist();
        await tx1.wait();

        await buyCards(29, phaseOnePrice, anotherUser);
        await expect(sellingController.phaseIndex()).to.eventually.equal(2);
        const tx = await buyCards(11, phaseThreePrice, anotherUser);
        await expect(tx)
          .to.emit(sellingController, 'SellingStopped')
          .withArgs();
        await expect(sellingController.phaseIndex()).to.eventually.equal(4);
      });

      it('Whitelist multiple buys until allowance met', async function () {
        const p1 = {price: phaseOnePrice, threshold: 30};
        const sellingControllerFactory = await ethers.getContractFactory(
          'SellingController'
        );
        [whitelistRoot, proofs, maxCap] = await cleanupAndCreateTestWhitelist(
          [{address: anotherUser.address, cap: 10, partner: false}],
          owner
        );
        sellingController = (await sellingControllerFactory.deploy(
          'hash-of-cardback-on-ipfs',
          [p1],
          vault.address,
          maintainer.address,
          owner.address, // `owner` set as the initial owner of NFT
          10,
          100_000,
          whitelistRoot,
          0
        )) as SellingController;
        await sellingController.deployed();

        await buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser);
        await buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser);
        await buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser);
        await expect(sellingController.whitelistEnabled()).to.eventually.equal(
          true
        );
        const allowance = (
          await sellingController.getWhitelistEntry(anotherUser.address)
        ).allowance;
        expect(allowance.toString()).to.equal('1');
        await expect(
          buyCardsWhenWhitelisted(3, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Cannot buy more cards than permitted!');
        await buyCardsWhenWhitelisted(1, phaseOnePrice, anotherUser);
        await expect(
          buyCardsWhenWhitelisted(1, phaseOnePrice, anotherUser)
        ).to.be.revertedWith('Cannot buy more cards than permitted!');

        await sellingController.connect(maintainer).disableWhitelist();
        await expect(sellingController.phaseIndex()).to.eventually.equal(0);
        const nftFactory = await ethers.getContractFactory('NFT');

        nft = nftFactory.attach(await sellingController.nftToken()) as NFT;
        await expect(nft.totalSupply()).to.eventually.equal(10);
        await expect(sellingController.isSellingStopped()).to.eventually.equal(
          false
        );

        const tx = await buyCards(20, phaseOnePrice, anotherUser);
        await expect(sellingController.isSellingStopped()).to.eventually.equal(
          true
        );
        await expect(tx)
          .to.emit(sellingController, 'SellingStopped')
          .withArgs();
      });
    });

    async function setup(
      owner: SignerWithAddress,
      items: MerkleTreeItem[],
      whitelistCap: number,
      sellingLaunch = 0
    ): Promise<{controller: SellingController; nft: NFT}> {
      [whitelistRoot, proofs, maxCap] = await cleanupAndCreateTestWhitelist(
        items,
        owner
      );
      const controller = await new SellingController__factory(owner).deploy(
        'ipfs://hash-of-cardback-on-ipfs',
        [p1],
        vault.address,
        owner.address, // `Owner` set as the maintainer,
        owner.address, // `Owner` set as the initial owner of NFT
        maxCap,
        whitelistCap,
        whitelistRoot,
        sellingLaunch
      );
      const nft = NFT__factory.connect(await controller.nftToken(), owner);

      return {controller, nft};
    }

    const buyWhitelisted = (
      count: number,
      signer: SignerWithAddress,
      controller = sellingController,
      partner = false
    ) =>
      buyCardsWhenWhitelisted(
        count,
        phaseOnePrice,
        signer,
        controller,
        partner
      );

    const buyTokensUsingController =
      (fetchController: () => SellingController) =>
      (count: number, signer: SignerWithAddress) =>
        buyWhitelisted(count, signer, fetchController(), false);

    const buyAsPartnerUsingController =
      (fetchController: () => SellingController) => (count: number) =>
        buyWhitelisted(count, partner, fetchController(), true);

    describe('when whitelist cap is 8', () => {
      const CAP = 8;
      let controller: SellingController;
      let nft: NFT;
      let users: SignerWithAddress[];

      const buyTokens = buyTokensUsingController(() => controller);

      beforeEach(async () => {
        users = [anotherUser, anotherUser2, anotherUser3];
        ({controller, nft} = await setup(
          owner,
          users.map((u) => ({address: u.address, cap: CAP, partner: false})),
          CAP
        ));
      });

      it('should decrease whitelist cap when user buys token', async () => {
        await buyTokens(1, anotherUser);

        expect(await controller.getWhitelistCap()).to.eq(CAP - 1);
      });

      it('should allow each user to buy 1 token', async () => {
        for (const user of users) {
          await buyTokens(1, user);
        }

        for (const user of users) {
          expect(await nft.balanceOf(user.address)).to.eq(1);
        }
      });

      it('should forbid to by more than whitelist cap', async () => {
        await buyTokens(CAP, anotherUser);

        await expect(buyTokens(1, anotherUser2)).to.be.revertedWith(
          'Reached whitelist token cap'
        );
      });

      it('should forbid to buy non-whitelisted users after whitelist cap', async () => {
        await buyTokens(CAP, anotherUser);

        await expect(buyTokens(1, owner)).to.be.revertedWith(
          'Address is not on the whitelist!'
        );
      });

      it('should allow to buy non-whitelisted users after whitelist is disabled', async () => {
        await controller.disableWhitelist();

        await buyTokens(2, owner);

        expect(await nft.balanceOf(owner.address)).to.eq(2);
      });
    });

    describe('when partners are in whitelist', () => {
      const CAP = 8;
      let controller: SellingController;
      let nft: NFT;
      let users: SignerWithAddress[];

      const buyAsPartner = buyAsPartnerUsingController(() => controller);
      const buyTokens = buyTokensUsingController(() => controller);

      beforeEach(async () => {
        users = [anotherUser, anotherUser2, partner];
        ({controller, nft} = await setup(
          owner,
          users.map((u) => ({
            address: u.address,
            cap: CAP,
            partner: u.address === partner.address,
          })),
          CAP
        ));
      });

      it('should allow partner to buy tokens', async () => {
        await buyAsPartner(1);

        expect(await nft.balanceOf(partner.address)).to.eq(1);
      });

      it('should not decrease whitelist cap when partner is buying tokens', async () => {
        await buyAsPartner(1);

        expect(await controller.getWhitelistCap()).to.eq(CAP);
      });

      it('should allow partner to buy tokens after whitelist cap is reached', async () => {
        await buyTokens(CAP, anotherUser);

        await buyAsPartner(1);

        expect(await nft.balanceOf(partner.address)).to.eq(1);
      });

      it('should allow partner to buy tokens after whitelist is disabled', async () => {
        await controller.disableWhitelist();

        await buyAsPartner(1);

        expect(await nft.balanceOf(partner.address)).to.eq(1);
      });

      it('should not allow partner to buy more than his cap', async () => {
        await expect(buyAsPartner(CAP + 1)).to.be.revertedWith(
          'Cannot buy more cards than permitted!'
        );
      });
    });

    describe('when selling launch time is set', () => {
      const SELLING_LAUNCH_DELAY = 10000;
      const CAP = 10;
      const buyAsPartner = buyAsPartnerUsingController(() => controller);
      const buyTokens = buyTokensUsingController(() => controller);
      let controller: SellingController;
      let nft: NFT;

      beforeEach(async () => {
        const now = await getTime();
        const users = [anotherUser, anotherUser2, partner];
        ({controller, nft} = await setup(
          owner,
          users.map((u) => ({
            address: u.address,
            cap: CAP,
            partner: u.address === partner.address,
          })),
          CAP,
          now + SELLING_LAUNCH_DELAY
        ));
      });

      describe('when selling is not launched', () => {
        it('forbids partner to buy tokens', async () => {
          await expect(buyAsPartner(1)).to.be.revertedWith(
            'Selling is not launched yet!'
          );
        });

        it('forbids whitelisted user to buy tokens', async () => {
          await expect(buyTokens(1, anotherUser)).to.be.revertedWith(
            'Selling is not launched yet!'
          );
        });

        it('forbids regular user to buy tokens', async () => {
          await expect(buyTokens(1, owner)).to.be.revertedWith(
            'Selling is not launched yet!'
          );
        });
      });

      describe('when selling is launched', () => {
        beforeEach(async () => {
          await forceTime(SELLING_LAUNCH_DELAY);
        });

        it('allows partner to buy tokens', async () => {
          await buyAsPartner(1);

          await expect(nft.balanceOf(partner.address)).to.be.eventually.eq(1);
        });

        it('allows whitelisted user to buy tokens', async () => {
          await buyTokens(1, anotherUser);

          await expect(nft.balanceOf(anotherUser.address)).to.be.eventually.eq(
            1
          );
        });

        it('forbids regular user to buy tokens', async () => {
          await expect(buyTokens(1, owner)).to.be.revertedWith(
            'Address is not on the whitelist!'
          );
        });
      });
    });
  });

  describe('NFT trading', function () {
    let anotherUser1: SignerWithAddress;
    let anotherUser2: SignerWithAddress;
    let anotherUser3: SignerWithAddress;
    beforeEach(async function () {
      [owner, anotherUser1, anotherUser2, anotherUser3] =
        await ethers.getSigners();
      await buyCardsWhenWhitelisted(5, phaseOnePrice, anotherUser1);
      await buyCardsWhenWhitelisted(5, phaseOnePrice, anotherUser2);
    });

    it('Trade while minting period still ON', async function () {
      await nft
        .connect(anotherUser1)
        .transferFrom(anotherUser1.address, anotherUser2.address, 5);

      expect(await nft.balanceOf(anotherUser1.address)).to.equal('4');
      expect(await nft.balanceOf(anotherUser2.address)).to.equal('6');
      expect(await nft.ownerOf(5)).to.equal(anotherUser2.address);
    });

    it('Trade while minting period OFF', async function () {
      // ------------------- Stop minting period ------------------
      await buyCardsWhenWhitelisted(20, phaseTwoPrice, anotherUser3);

      await nft
        .connect(anotherUser1)
        .transferFrom(anotherUser1.address, anotherUser2.address, 5);

      expect(await nft.balanceOf(anotherUser1.address)).to.equal('4');
      expect(await nft.balanceOf(anotherUser2.address)).to.equal('6');
      expect(await nft.ownerOf(5)).to.equal(anotherUser2.address);
    });
  });

  describe('Game Controller', function () {
    let tree: MerkleTree;
    let resProofsObject: FinalProofMapping;
    beforeEach(async function () {
      // Emulate the card gen code
      const tokenIds = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const cards = (
        await Promise.all(
          tokenIds.map((t) => {
            const ipfs = `ipfs-${t}`;
            const dna = t * 10;
            const packedReveal = solidityPack(
              ['uint256', 'uint256', 'string', 'address', 'uint256'],
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              [dna, t, ipfs, gameController.address, network.config.chainId!]
            );
            const revealHash = keccak256(
              Buffer.from(packedReveal.slice(2), 'hex')
            );
            return {
              [t]: {
                dna: t * 10,
                hash: revealHash,
                ipfsUri: ipfs,
              },
            };
          })
        )
      ).reduce((acc, curr) => {
        return {...acc, ...curr};
      }, {});

      // Clean up old files
      // console.log('removing old files');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pathBase = `/tmp/artifacts/${network.config.chainId!.toString()}`;
      await promises.rm(pathBase, {recursive: true, force: true});

      // Create new dir
      // console.log('creating dir');
      const testDir = `${pathBase}/${gameController.address.toLowerCase()}`;
      await promises.mkdir(testDir, {recursive: true});

      // Write test file
      const testPath = `${testDir}/gen_card_info.json`;
      const testPathOutput = `${testDir}/gen_card_info_tree.json`;
      // console.log('creating file');
      await promises.writeFile(testPath, JSON.stringify(cards));

      // console.log('generating tree');
      const res = await generateMerkleTree(testPath, testPathOutput);
      ({tree, resProofsObject} = res);
      await sellingController.connect(maintainer).disableWhitelist();
      await buyCards(2, phaseOnePrice, anotherUser);
      await buyCards(2, phaseOnePrice, anotherUser2);
      await buyCards(1, phaseOnePrice, anotherUser);
      await buyCards(1, phaseOnePrice, anotherUser2);
      await buyCards(3, phaseOnePrice, anotherUser3);
      {
        // Fill the consumer with LINK tokens
        await linkToken.transfer(gameController.address, pricePerLink);
      }

      await expect(gameController.startGame()).to.be.revertedWith(
        'Only the token seller contract can initiate the game!'
      );
    });

    it('Can get/set maintainer', async function () {
      await expect(gameController.getMaintainer()).to.eventually.equal(
        gameControllerMaintainer.address
      );

      await gameController.setMaintainer(anotherUser.address);
      await expect(gameController.getMaintainer()).to.eventually.equal(
        anotherUser.address
      );
    });

    it('Invalid GameController deploy parameters', async function () {
      const gameControllerFactory = await ethers.getContractFactory(
        'GameController'
      );
      await expect(
        gameControllerFactory.deploy(
          '0x0000000000000000000000000000000000000000',
          sellingController.address,
          {
            vrfCoordinator: vrfCoordinator.address,
            link: linkToken.address,
            keyHash,
            fee: pricePerLink,
          },
          gameControllerMaintainer.address
        )
      ).to.be.revertedWith('NFT address is zero address');
      await expect(
        gameControllerFactory.deploy(
          nft.address,
          '0x0000000000000000000000000000000000000000',
          {
            vrfCoordinator: vrfCoordinator.address,
            link: linkToken.address,
            keyHash,
            fee: pricePerLink,
          },
          gameControllerMaintainer.address
        )
      ).to.be.revertedWith('SellingController is zero address');
      await expect(
        gameControllerFactory.deploy(
          nft.address,
          sellingController.address,
          {
            vrfCoordinator: vrfCoordinator.address,
            link: linkToken.address,
            keyHash,
            fee: pricePerLink,
          },
          '0x0000000000000000000000000000000000000000'
        )
      ).to.be.revertedWith('Maintainer is zero address');
    });

    describe('Randomness set', function () {
      beforeEach(async function () {
        await sellingController.forceStopSelling();
        await sellingController
          .connect(owner)
          .startGame(gameController.address);
      });
      describe('Card reveals', function () {
        beforeEach(async function () {
          await expect(
            gameController
              .connect(anotherUser)
              .setCardMerkleRootReveal(tree.getRoot())
          ).to.be.revertedWith('Ownable: caller is not the owner');
          await expect(
            gameController.setCardMerkleRootReveal(tree.getRoot())
          ).to.be.revertedWith('The random seed is not known yet!');
          {
            // Fulfill the randomness
            const requestId = await gameController.requestId();
            await vrfCoordinator.callBackWithRandomness(
              requestId,
              BigNumber.from('42'),
              gameController.address
            );
          }

          const tokenId = 3;
          const proof = resProofsObject[tokenId].merkleProof;
          const ipfsUri = resProofsObject[tokenId].ipfsUri;
          const dna = resProofsObject[tokenId].dna;
          await expect(
            gameController
              .connect(anotherUser)
              .revealCard(proof, tokenId, ipfsUri, dna)
          ).to.be.revertedWith(
            'The `reveals` functionality has not yet been enabled!'
          );
          await gameController.setCardMerkleRootReveal(tree.getRoot());
        });

        it('Can get reveal merkle root', async function () {
          await expect(
            gameController.getCardRevealMerkleRoot()
          ).to.eventually.equal(ethers.utils.hexlify(tree.getRoot()));
        });

        it('Owner can validate card', async function () {
          for (const user of [anotherUser, anotherUser2, anotherUser3]) {
            const totalTokensForUser = (
              await nft.balanceOf(user.address)
            ).toNumber();
            for (let index = 0; index < totalTokensForUser; index++) {
              const tokenId = (
                await nft.tokenOfOwnerByIndex(user.address, index)
              ).toNumber();
              const proof = resProofsObject[tokenId].merkleProof;
              const ipfsUri = resProofsObject[tokenId].ipfsUri;
              const dna = resProofsObject[tokenId].dna;

              // Before reveal
              await expect(gameController.getDna(tokenId)).to.eventually.equal(
                0
              );
              const defaultCardCid = await nft.getDefaultCID();
              await expect(nft.tokenURI(tokenId)).to.eventually.equal(
                `ipfs://${defaultCardCid}`
              );

              // After reveal
              console.log('revealing', tokenId, ipfsUri, dna);
              await gameController
                .connect(user)
                .revealCard(proof, tokenId, ipfsUri, dna);

              await expect(gameController.getDna(tokenId)).to.eventually.equal(
                dna
              );
              await expect(nft.tokenURI(tokenId)).to.eventually.equal(
                `ipfs://${ipfsUri}`
              );
              // Card cannot be revealed twice
              await expect(
                gameController
                  .connect(user)
                  .revealCard(proof, tokenId, ipfsUri, dna)
              ).to.be.revertedWith('Card has already been revealed!');
            }
          }
        });

        it('Invalid card proof', async function () {
          // Try to revel a card with ID 1, using proof from card with ID 9
          const tokenIdForUser3 = 9;
          const tokenIdForUser1 = 1;
          const proof = resProofsObject[tokenIdForUser3].merkleProof;
          const ipfsUri = resProofsObject[tokenIdForUser3].ipfsUri;
          const dna = resProofsObject[tokenIdForUser3].dna;
          await expect(
            gameController
              .connect(anotherUser)
              .revealCard(proof, tokenIdForUser1, ipfsUri, dna)
          ).to.be.revertedWith('The card data has been tampered with!');
        });

        it('Non-Owner cannot validate card', async function () {
          const tokenIdForUser3 = 9;
          const proof = resProofsObject[tokenIdForUser3].merkleProof;
          const ipfsUri = resProofsObject[tokenIdForUser3].ipfsUri;
          const dna = resProofsObject[tokenIdForUser3].dna;
          await expect(
            gameController
              .connect(anotherUser)
              .revealCard(proof, tokenIdForUser3, ipfsUri, dna)
          ).to.be.revertedWith('Only owner can use this token!');
        });

        it('Roots can only be set one', function () {
          expect(
            gameController.setCardMerkleRootReveal(tree.getRoot())
          ).to.be.revertedWith('Merkle root for reveals can only be set once!');
        });

        describe('Card upgrades', function () {
          let backend: BackendMock;
          const anotherUserTokens: Array<number> = [];
          beforeEach(async function () {
            // Reveal all cards for `anotherUser`
            for (const user of [anotherUser]) {
              const totalTokensForUser = (
                await nft.balanceOf(user.address)
              ).toNumber();
              for (let index = 0; index < totalTokensForUser - 1; index++) {
                const tokenId = (
                  await nft.tokenOfOwnerByIndex(user.address, index)
                ).toNumber();
                const proof = resProofsObject[tokenId].merkleProof;
                const ipfsUri = resProofsObject[tokenId].ipfsUri;
                const dna = resProofsObject[tokenId].dna;
                // After reveal
                console.log('revealing', tokenId, ipfsUri, dna);
                await gameController
                  .connect(user)
                  .revealCard(proof, tokenId, ipfsUri, dna);

                anotherUserTokens.push(tokenId);
              }
              const tokenId = (
                await nft.tokenOfOwnerByIndex(
                  user.address,
                  totalTokensForUser - 1
                )
              ).toNumber();
              anotherUserTokens.push(tokenId);
            }
            backend = new BackendMock(
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              network.config.chainId!,
              gameController.address,
              gameControllerMaintainer
            );

            const upgrade = {
              newCID: 'test-upgrade',
              newDna: 42,
              secondaryCardId: anotherUserTokens[0],
              primaryCardId: anotherUserTokens[1],
            };
            const signature = await backend.signUpgradeMessage(upgrade);
            await expect(
              gameController
                .connect(anotherUser)
                .upgradeCard(signature, upgrade)
            ).to.be.revertedWith(
              'The `upgrades` functionality has not yet been enabled!'
            );

            await expect(
              gameController.isCardUpgradeEnabled()
            ).to.eventually.equal(false);
            await gameController.enableCardUpgrades();
            await expect(
              gameController.isCardUpgradeEnabled()
            ).to.eventually.equal(true);
          });

          it('Upgrade already started', async function () {
            await expect(
              gameController.enableCardUpgrades()
            ).to.be.revertedWith('Upgrades already started');
          });

          it('Upgrades successfully', async function () {
            const upgrade = {
              newCID: 'test-upgrade',
              newDna: 42,
              secondaryCardId: anotherUserTokens[0],
              primaryCardId: anotherUserTokens[1],
            };
            const signature = await backend.signUpgradeMessage(upgrade);
            const tx = await gameController
              .connect(anotherUser)
              .upgradeCard(signature, upgrade);
            await tx.wait();
            await expect(
              gameController.getDna(anotherUserTokens[1])
            ).to.eventually.equal(42);
            await expect(
              nft.tokenURI(anotherUserTokens[1])
            ).to.eventually.equal(`ipfs://test-upgrade`);
          });

          it('cannot upgrade twice', async function () {
            const upgrade = {
              newCID: 'test-upgrade',
              newDna: 42,
              secondaryCardId: anotherUserTokens[0],
              primaryCardId: anotherUserTokens[1],
            };
            const signature = await backend.signUpgradeMessage(upgrade);
            await gameController
              .connect(anotherUser)
              .upgradeCard(signature, upgrade);
            // Second time the same signature no longer works
            await expect(
              gameController
                .connect(anotherUser)
                .upgradeCard(signature, upgrade)
            ).to.be.revertedWith('This message has already been executed!');
          });

          it('cannot upgrade unrevealed upgrade card', async function () {
            const upgrade = {
              newCID: 'test-upgrade',
              newDna: 42,
              secondaryCardId: anotherUserTokens[2],
              primaryCardId: anotherUserTokens[0],
            };
            const signature = await backend.signUpgradeMessage(upgrade);
            // Second time the same signature no longer works
            await expect(
              gameController
                .connect(anotherUser)
                .upgradeCard(signature, upgrade)
            ).to.be.revertedWith('Card needs to be revealed!');
          });

          it('cannot upgrade unrevealed second card', async function () {
            const upgrade = {
              newCID: 'test-upgrade',
              newDna: 42,
              secondaryCardId: anotherUserTokens[0],
              primaryCardId: anotherUserTokens[2],
            };
            const signature = await backend.signUpgradeMessage(upgrade);
            // Second time the same signature no longer works
            await expect(
              gameController
                .connect(anotherUser)
                .upgradeCard(signature, upgrade)
            ).to.be.revertedWith('Card needs to be revealed!');
          });

          it('was not signed by the maintainer', async function () {
            const upgrade = {
              newCID: 'test-upgrade',
              newDna: 42,
              secondaryCardId: anotherUserTokens[0],
              primaryCardId: anotherUserTokens[1],
            };
            const anotherMaintainer = ethers.Wallet.createRandom();
            const falseBackend = new BackendMock(
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              network.config.chainId!,
              gameController.address,
              anotherMaintainer
            );
            const signature = await falseBackend.signUpgradeMessage(upgrade);
            // Second time the same signature no longer works
            await expect(
              gameController
                .connect(anotherUser)
                .upgradeCard(signature, upgrade)
            ).to.be.revertedWith('Maintainer did not sign this message!');
          });

          describe('Finding satoshi', function () {
            it('Mint multiple new cards', async function () {
              const findSatoshi = {
                freakCardId: anotherUserTokens[0],
                geekCardId: anotherUserTokens[0],
                slackerCardId: anotherUserTokens[0],
                hackerCardId: anotherUserTokens[0],
                newCardsCids: ['new-cid-1', 'new-cid-2', 'new-cid-3'],
                newCardsDnas: [9999, 888, 10101],
              };

              const signature = backend.signFindSatoshiMessage(findSatoshi);

              const totalNfts = (await nft.totalSupply()).toNumber();
              const tx = await gameController
                .connect(anotherUser)
                .findSatoshi(signature, findSatoshi);
              await tx.wait();

              // Perform assertions
              await expect(tx)
                .to.emit(gameController, 'DnaUpdated')
                .withArgs(totalNfts + 1, 9999, 'new-cid-1');
              await expect(tx)
                .to.emit(gameController, 'DnaUpdated')
                .withArgs(totalNfts + 2, 888, 'new-cid-2');
              await expect(tx)
                .to.emit(gameController, 'DnaUpdated')
                .withArgs(totalNfts + 3, 10101, 'new-cid-3');

              await expect(nft.tokenURI(totalNfts + 1)).to.eventually.equal(
                'ipfs://new-cid-1'
              );
              await expect(nft.tokenURI(totalNfts + 2)).to.eventually.equal(
                'ipfs://new-cid-2'
              );
              await expect(nft.tokenURI(totalNfts + 3)).to.eventually.equal(
                'ipfs://new-cid-3'
              );

              await expect(nft.ownerOf(totalNfts + 1)).to.eventually.equal(
                anotherUser.address
              );
              await expect(nft.ownerOf(totalNfts + 2)).to.eventually.equal(
                anotherUser.address
              );
              await expect(nft.ownerOf(totalNfts + 3)).to.eventually.equal(
                anotherUser.address
              );

              await expect(
                gameController.getDna(totalNfts + 1)
              ).to.eventually.equal(BigNumber.from(9999));
              await expect(
                gameController.getDna(totalNfts + 2)
              ).to.eventually.equal(BigNumber.from(888));
              await expect(
                gameController.getDna(totalNfts + 3)
              ).to.eventually.equal(BigNumber.from(10101));
              // Make sure that the same message cannot be executed multiple times
              await expect(
                gameController
                  .connect(anotherUser)
                  .findSatoshi(signature, findSatoshi)
              ).to.be.revertedWith('This message has already been executed!');
            });

            it('Cannot reveal the same hero twice', async function () {
              const findSatoshi = {
                freakCardId: anotherUserTokens[0],
                geekCardId: anotherUserTokens[0],
                slackerCardId: anotherUserTokens[0],
                hackerCardId: anotherUserTokens[0],
                newCardsCids: ['new-cid-1', 'new-cid-2', 'new-cid-3'],
                newCardsDnas: [9999, 888, 10101],
              };

              // Find some x satoshi cards once
              const signature = backend.signFindSatoshiMessage(findSatoshi);
              const tx = await gameController
                .connect(anotherUser)
                .findSatoshi(signature, findSatoshi);
              await tx.wait();

              // Try finding one of the previous cards again
              const findSatoshi2 = {
                freakCardId: anotherUserTokens[1],
                geekCardId: anotherUserTokens[1],
                slackerCardId: anotherUserTokens[1],
                hackerCardId: anotherUserTokens[1],
                newCardsCids: ['new-cid-100'],
                newCardsDnas: [9999], // DNA repeats from the previous reveal
              };

              const signature2 = backend.signFindSatoshiMessage(findSatoshi2);

              await expect(
                gameController
                  .connect(anotherUser)
                  .findSatoshi(signature2, findSatoshi2)
              ).to.be.revertedWith('This ending has already been revealed!');
            });

            it('Only owner can use the token', async function () {
              const findSatoshi = {
                freakCardId: anotherUserTokens[0],
                geekCardId: anotherUserTokens[0],
                slackerCardId: anotherUserTokens[0],
                hackerCardId: anotherUserTokens[0],
                newCardsCids: ['new-cid-1', 'new-cid-2', 'new-cid-3'],
                newCardsDnas: [9999, 888, 10101],
              };

              const signature = backend.signFindSatoshiMessage(findSatoshi);

              await expect(
                gameController
                  .connect(anotherUser2)
                  .findSatoshi(signature, findSatoshi)
              ).to.be.revertedWith('Only owner can use this token!');
            });

            it('Maintainer did not sign the message', async function () {
              const findSatoshi = {
                freakCardId: anotherUserTokens[0],
                geekCardId: anotherUserTokens[0],
                slackerCardId: anotherUserTokens[0],
                hackerCardId: anotherUserTokens[0],
                newCardsCids: ['new-cid-1', 'new-cid-2', 'new-cid-3'],
                newCardsDnas: [9999, 888, 10101],
              };

              const signature = backend.signFindSatoshiMessage(findSatoshi);
              const findSatoshiAltered = {
                ...findSatoshi,
                // NOTE: Passing in custom supplied CID, that the backend did not sign!
                newCardsCids: ['custom-supplied-cid', 'new-cid-2', 'new-cid-3'],
              };
              await expect(
                gameController
                  .connect(anotherUser)
                  .findSatoshi(signature, findSatoshiAltered)
              ).to.be.revertedWith('Maintainer did not sign this message!');
            });
          });
        });
      });
    });

    describe('Randomness not set', function () {
      it('gameController not the owner of the NFT contract', async function () {
        await expect(gameController.retryRandomness()).to.be.revertedWith(
          'Can only call after game controller becomes the controller of NFTs!'
        );
      });

      it('ChainLink request never dispatched', async function () {
        await sellingController.forceStopSelling();
        {
          // Fill the consumer with LINK tokens
          await linkToken.transfer(gameController.address, pricePerLink);
        }

        const failedGameImpl = await ethers.getContractFactory('FailedGameV3');
        const failedGameImplDeployed =
          (await failedGameImpl.deploy()) as FailedGameV3;
        await sellingController
          .connect(owner)
          .startGame(failedGameImplDeployed.address);
        await failedGameImplDeployed.retrieveOwnedContract(nft.address);
        // Transfer ownership of the NFT contract without calling `startGame` on the gameController
        await nft.transferController(gameController.address);
        await expect(gameController.retryRandomness()).to.be.revertedWith(
          'The ChainLink request has never been dispatched!'
        );
      });

      it("Cannot get a new random result if one's already set", async function () {
        await sellingController.forceStopSelling();
        await sellingController
          .connect(owner)
          .startGame(gameController.address);
        {
          // Fulfill the randomness
          const requestId = await gameController.requestId();
          await vrfCoordinator.callBackWithRandomness(
            requestId,
            BigNumber.from('42'),
            gameController.address
          );
        }

        await expect(gameController.retryRandomness()).to.be.revertedWith(
          'Random number can only be set once!'
        );
      });

      it('Successful retry of randomness', async function () {
        await sellingController.forceStopSelling();
        await sellingController
          .connect(owner)
          .startGame(gameController.address);
        const requestId = await gameController.requestId();
        {
          // Fill the consumer with more LINK tokens
          await linkToken.transfer(gameController.address, pricePerLink);
          // Fulfill the randomness
          await vrfCoordinator.callBackWithRandomness(
            requestId,
            BigNumber.from('0'), // setting the result as `0`!
            gameController.address
          );
        }
        await gameController.retryRandomness();
        await expect(gameController.requestId()).to.not.eventually.equal(
          requestId
        );
      });

      it('Not enough LINK', async function () {
        await sellingController.forceStopSelling();
        await sellingController
          .connect(owner)
          .startGame(gameController.address);
        const requestId = await gameController.requestId();
        {
          // Fulfill the randomness
          await vrfCoordinator.callBackWithRandomness(
            requestId,
            BigNumber.from('0'), // setting the result as `0`!
            gameController.address
          );
        }
        await expect(gameController.retryRandomness()).to.be.revertedWith(
          'Not enough LINK - fill contract with faucet'
        );
      });

      describe('ChainLink never responds, use overrideRandomNumber', function () {
        beforeEach(async function () {
          // Starting the game
          await sellingController.forceStopSelling();

          // This call attempts to communicate with ChainLink to retrieve a random number
          await sellingController
            .connect(owner)
            .startGame(gameController.address);
        });

        it('Successfully set random number', async function () {
          await forceTime(10800);
          await expect(gameController.randomResult()).to.eventually.equal(0);
          const tx = await gameController.connect(owner).overrideRandomNumber();

          await expect(tx).to.emit(gameController, 'GeneratedRandomNumber');

          await expect(gameController.randomResult()).to.eventually.not.equal(
            0
          );
        });

        it('Random number already set by chainlink', async function () {
          // Assume that chainlink has already set a random number
          const requestId = await gameController.requestId();
          {
            // Fulfill the randomness
            await vrfCoordinator.callBackWithRandomness(
              requestId,
              BigNumber.from('42'),
              gameController.address
            );
          }
          await expect(gameController.randomResult()).to.eventually.equal(42);

          // Anyway, we try to override with out own number.
          await forceTime(10800);
          await expect(
            gameController.connect(owner).overrideRandomNumber()
          ).to.be.revertedWith('Random number can only be set once!');
        });

        it('ChainLink calls back randomness after manual override', async function () {
          await forceTime(10800);
          await gameController.connect(owner).overrideRandomNumber();
          await expect(gameController.randomResult()).to.eventually.not.equal(
            0
          );

          const randomResultBefore = await gameController.randomResult();
          const requestId = await gameController.requestId();
          {
            // Fill the consumer with more LINK tokens
            await linkToken.transfer(gameController.address, pricePerLink);
            // Fulfill the randomness
            // For some reason this does not raise the expected exception.
            await vrfCoordinator.callBackWithRandomness(
              requestId,
              BigNumber.from('42'),
              gameController.address
            );
          }
          const randomResultAfter = await gameController.randomResult();

          // The result has not changed
          expect(randomResultAfter).to.equal(randomResultBefore);
        });

        it('Not enough time had passed', async function () {
          await forceTime(1000);
          await expect(gameController.randomResult()).to.eventually.equal(0);
          await expect(
            gameController.connect(owner).overrideRandomNumber()
          ).to.be.revertedWith(
            'Can only be executed after enough time had passed!'
          );
        });
      });
    });
  });
});

interface FindSatoshi {
  freakCardId: number;
  geekCardId: number;
  slackerCardId: number;
  hackerCardId: number;
  newCardsCids: Array<string>;
  newCardsDnas: Array<number>;
}

interface UpgradeCard {
  primaryCardId: number;
  secondaryCardId: number;
  newDna: number;
  newCID: string;
}
class BackendMock {
  /// The EIP-712 domain name used for computing the domain separator.
  DOMAIN_NAME = 'SatoshiQuest WebApp';
  /// The EIP-712 domain version used for computing the domain separator.
  DOMAIN_VERSION = 'v1';

  maintainer: Wallet;
  chainId: number;
  contractAddress: string;

  constructor(chainId: number, contractAddress: string, maintainer: Wallet) {
    this.chainId = chainId;
    this.contractAddress = contractAddress;
    this.maintainer = maintainer;
  }

  signUpgradeMessage(payload: UpgradeCard): Buffer {
    const message = this.constructUpgrade(payload);

    const signature = joinSignature(
      this.maintainer._signingKey().signDigest(message)
    );
    return Buffer.from(signature.slice(2), 'hex');
  }

  signFindSatoshiMessage(payload: FindSatoshi): Buffer {
    const message = this.constructFindSatoshi(payload);
    const signature = joinSignature(
      this.maintainer._signingKey().signDigest(message)
    );
    return Buffer.from(signature.slice(2), 'hex');
  }

  private constructUpgrade({
    primaryCardId,
    secondaryCardId,
    newDna,
    newCID,
  }: UpgradeCard): string {
    const data = {
      domain: {
        chainId: this.chainId,
        verifyingContract: this.contractAddress,
        name: this.DOMAIN_NAME,
        version: this.DOMAIN_VERSION,
      },
      types: {
        EIP712Domain: [
          {name: 'name', type: 'string'},
          {name: 'version', type: 'string'},
          {name: 'chainId', type: 'uint256'},
          {name: 'verifyingContract', type: 'address'},
        ],
        UpgradeParams: [
          // UpgradeParams(uint256 primaryCardId,uint256 secondaryCardId,uint256 newDna,string newCID)
          {name: 'primaryCardId', type: 'uint256'},
          {name: 'secondaryCardId', type: 'uint256'},
          {name: 'newDna', type: 'uint256'},
          {name: 'newCID', type: 'string'},
        ],
      },
      primaryType: 'UpgradeParams',
      message: {
        primaryCardId: primaryCardId,
        secondaryCardId: secondaryCardId,
        newDna: newDna,
        newCID: newCID,
      },
    };
    const digest = TypedDataUtils.encodeDigest(data);
    const digestHex = ethers.utils.hexlify(digest);
    return digestHex;
  }

  private constructFindSatoshi({
    freakCardId,
    geekCardId,
    slackerCardId,
    hackerCardId,
    newCardsCids,
    newCardsDnas,
  }: FindSatoshi): string {
    const data = {
      domain: {
        chainId: this.chainId,
        verifyingContract: this.contractAddress,
        name: this.DOMAIN_NAME,
        version: this.DOMAIN_VERSION,
      },
      types: {
        EIP712Domain: [
          {name: 'name', type: 'string'},
          {name: 'version', type: 'string'},
          {name: 'chainId', type: 'uint256'},
          {name: 'verifyingContract', type: 'address'},
        ],
        FindSatoshiParams: [
          {name: 'freakCardId', type: 'uint256'},
          {name: 'geekCardId', type: 'uint256'},
          {name: 'slackerCardId', type: 'uint256'},
          {name: 'hackerCardId', type: 'uint256'},
          {name: 'newCardsCids', type: 'string[]'},
          {name: 'newCardsDnas', type: 'uint256[]'},
        ],
      },
      primaryType: 'FindSatoshiParams',
      message: {
        freakCardId: freakCardId,
        geekCardId: geekCardId,
        slackerCardId: slackerCardId,
        hackerCardId: hackerCardId,
        newCardsCids: newCardsCids,
        newCardsDnas: newCardsDnas,
      },
    };
    const digest = TypedDataUtils.encodeDigest(data);
    const digestHex = ethers.utils.hexlify(digest);
    return digestHex;
  }
}
