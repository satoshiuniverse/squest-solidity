import {BigNumber} from '@ethersproject/bignumber';
import {parseEther} from '@ethersproject/units';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import hre, {ethers} from 'hardhat';
import {
  NFT,
  NFT__factory,
  SellingController,
  SellingController__factory,
} from '../../typechain';
import {impersonate, resetFork} from '../helper/utils';
const DEPLOYER = '0x9434bCB4ce46D772C5D584863c7C853ac65800b4';
const VAULT = '0x44faaF11E7a8503e74Cda10Bd6e58Cd6e484543e';
chai.use(chaiAsPromised);
describe('forking tests', () => {
  let controller: SellingController;
  let nft: NFT;
  let deployer: SignerWithAddress;
  let vaultBalance: BigNumber;
  beforeEach(async () => {
    await resetFork(hre, 13739280);

    await impersonate(hre, DEPLOYER);
    console.log('Block: ' + (await hre.ethers.provider.getBlockNumber()));
    deployer = await ethers.getSigner(DEPLOYER);
    console.log(`Deployer: ` + deployer.address);

    controller = await new SellingController__factory(deployer).deploy(
      '1',
      [
        {
          price: parseEther('0.08'),
          threshold: BigNumber.from('6000'),
        },
      ],
      VAULT,
      '0x87b6E9cF2d4ccA2D2765f6f38366e43Df9727A58',
      '0x87b6E9cF2d4ccA2D2765f6f38366e43Df9727A58',
      10,
      10,
      '0xb6ce7d1e8b68ea32c4f078edfd256cec15ad8c24233bdc71f082b1f0c93b3ffb',
      0
    );
    console.log('Deployed SellingController: ', controller.address);
    nft = NFT__factory.connect(await controller.nftToken(), deployer);

    vaultBalance = await ethers.provider.getBalance(VAULT);
  });

  it('whitelisted user buys', async () => {
    const buyer = '0x0019977941D62713b7Ff8472689EeDb465Ac1f4C';
    await impersonate(hre, buyer);
    const proof = [
      '0x681ee507afb037dcd987fa5631ddb02ea2a1a78fef02cc86ae0edd5093a4edfa',
      '0x9b964b4ecd3ab53c8ef1dd73ba11042a8a54de5682fca1495837bb8977682d46',
      '0x26f49010d1892a5da80541e907d940ef674b607789eb380f2650da58c75bfd7b',
      '0x69e4d313859a1fc820864cea26ea0d20e5ddc9e38f181fbcc8b8f1e4ae0462cd',
      '0x70b2aed5962875657ca11256e1d85de7c96f5a8c9949511bb6ad1103790f7c57',
      '0xecfb7126eab8c690981be1749445910e1828b47f17909b59991aa80d903c1620',
      '0x0bd1de2a34b2db46bee1440d6ba7f2a71db5b3208a459aaddbe5cad89068390b',
      '0x74dcda19a271ba460aea5fff9c6fbe11260de7361471e104fc0693146fc7edd7',
      '0x2142e2848d7da28f23d5c6f38df868d18446d71e3de4d82c259bd36a56cd45fe',
      '0x7d216692a5556e41c08085fbc141d003000b901448192e8cea961f0bc7427e92',
      '0xc3eb78d236022ec575062f013c1961cea3fb61a7c3c285b407bda65ffe28fae7',
    ];

    console.log('Balance:' + (await hre.ethers.provider.getBalance(buyer)));

    const buyerSigner = await ethers.getSigner(buyer);

    await controller.connect(buyerSigner).buyCards(proof, 5, false, {
      value: parseEther('0.16'),
    });

    await expect(nft.balanceOf(buyer)).to.eventually.eq(2);
    await expect(ethers.provider.getBalance(VAULT)).to.be.eventually.eq(
      vaultBalance.add(parseEther('0.16'))
    );
  });

  it('partner buys', async () => {
    const buyer = '0x035a6Ef9b70D4e65c79aC4b1595B7A7691a9Ac25';
    await impersonate(hre, buyer);
    const proof = [
      '0x666ee6c238068bff7709b3ac2dfe418d09083900814ee0568675a8ecdadc3980',
      '0x805d0329f5f21b9ac5ea657abb0f7328bd2b49a79b73a17664c8a551215d4c67',
      '0x6d3ada8bac2cf68954b3d19cf157225ea4c4cd696e444f835a47fd1a518d82c4',
      '0xac361983aaabf70c8eea75f2dc1067bc3d89cf8867f772330bccc750fd6592fc',
      '0x70b2aed5962875657ca11256e1d85de7c96f5a8c9949511bb6ad1103790f7c57',
      '0xecfb7126eab8c690981be1749445910e1828b47f17909b59991aa80d903c1620',
      '0x0bd1de2a34b2db46bee1440d6ba7f2a71db5b3208a459aaddbe5cad89068390b',
      '0x74dcda19a271ba460aea5fff9c6fbe11260de7361471e104fc0693146fc7edd7',
      '0x2142e2848d7da28f23d5c6f38df868d18446d71e3de4d82c259bd36a56cd45fe',
      '0x7d216692a5556e41c08085fbc141d003000b901448192e8cea961f0bc7427e92',
      '0xc3eb78d236022ec575062f013c1961cea3fb61a7c3c285b407bda65ffe28fae7',
    ];
    console.log('Balance:' + (await hre.ethers.provider.getBalance(buyer)));
    const buyerSigner = await ethers.getSigner(buyer);
    await deployer.sendTransaction({
      to: buyer,
      value: parseEther('0.5'),
    });

    await controller.connect(buyerSigner).buyCards(proof, 5, true, {
      value: parseEther('0.4'),
    });

    await expect(nft.balanceOf(buyer)).to.eventually.eq(5);
    await expect(
      controller.connect(buyerSigner).buyCards(proof, 5, true, {
        value: parseEther('0.08'),
      })
    ).to.be.reverted;
    await expect(
      ethers.provider.getBalance('0x44faaF11E7a8503e74Cda10Bd6e58Cd6e484543e')
    ).to.be.eventually.eq(vaultBalance.add(parseEther('0.4')));
  });
});
