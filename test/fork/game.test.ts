import {parseEther} from '@ethersproject/units';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import hre from 'hardhat';
import PROOFS from '../../tasks/generated/1/0x8E1dB865C777622e3d64D50589E036A8E09Cb2e8/gen_card_info_proofs.json';
import {
  GameController,
  GameController__factory,
  NFT,
  NFT__factory,
  SellingController,
  SellingController__factory,
} from '../../typechain';
import {impersonate, resetFork} from '../helper/utils';

const DEPLOYER = '0x9434bCB4ce46D772C5D584863c7C853ac65800b4';
const SELLING_CONTROLLER = '0xA524FEee0Bb8e1FE759e281422e153DcD784564d';
const GAME_CONTROLLER = '0x8E1dB865C777622e3d64D50589E036A8E09Cb2e8';
const OWNER = '0x87b6E9cF2d4ccA2D2765f6f38366e43Df9727A58';
const MERKLE_ROOT =
  '0x37eed5aba758b2b882e85de86928f14387c9bf4f5529af5790b9b827d63ef952';
const CARD_OWNERS = [
  '0x4bbad93331ca80c84602d5bddd594da245fb2621',
  '0x40058722e018af77e7a04bff560da431234bbb3b',
  '0x1044910bd2a705d2dfb978081452ecce1801d555',
];

chai.use(chaiAsPromised);
describe('forking tests', () => {
  let controller: SellingController;
  let nft: NFT;
  let game: GameController;
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let admin: SignerWithAddress;
  let cardOwners: SignerWithAddress[];

  beforeEach(async () => {
    await resetFork(hre, 13768890);

    [admin] = await hre.ethers.getSigners();

    deployer = await impersonate(hre, DEPLOYER);
    owner = await impersonate(hre, OWNER);

    cardOwners = await Promise.all(CARD_OWNERS.map((x) => impersonate(hre, x)));

    console.log('Block: ' + (await hre.ethers.provider.getBlockNumber()));
    console.log(`Deployer: ` + deployer.address);

    await admin.sendTransaction({
      to: OWNER,
      value: parseEther('10'),
    });

    controller = SellingController__factory.connect(
      SELLING_CONTROLLER,
      deployer
    );
    nft = NFT__factory.connect(await controller.nftToken(), deployer);
    game = GameController__factory.connect(GAME_CONTROLLER, deployer);
    console.log('Game owner: ' + (await game.owner()));

    await game.connect(owner).setCardMerkleRootReveal(MERKLE_ROOT);
  });

  it('should reveal the card', async () => {
    for (const cardOwner of cardOwners) {
      const cards = await Promise.all(
        [0, 1, 2, 3, 4].map((x) =>
          nft.tokenOfOwnerByIndex(cardOwner.address, x)
        )
      );

      for (const card of cards) {
        const info = (PROOFS as unknown as any)[card.toString()];

        await game
          .connect(cardOwner)
          .revealCard(info.merkleProof, card, info.ipfsUri, info.dna);

        await expect(game.getDna(card)).to.be.eventually.eq(info.dna);
      }
    }
  });
});
