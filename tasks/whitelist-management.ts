import async from 'async';
import {solidityKeccak256} from 'ethers/lib/utils';
import {promises} from 'fs';
import {readFile} from 'fs/promises';
import {ethers} from 'hardhat';
import {task, types} from 'hardhat/config';

import {MerkleTree} from '../scripts/MerkleTree/merkle-tree';

interface WhitestItems {
  address: string;
  cap: number;
  partner: boolean;
}

export interface FinalWhitelistProofMapping {
  [key: string]: {
    cap: number;
    merkleProof: Array<string>;
    partner: boolean;
  };
}

task('SQ:address-whitelist', 'Generate the merkle tree and mappings')
  .addParam(
    'whitelistInput',
    'The path to the json file of addresses which must be Merklized'
  )
  .addParam(
    'proofOutput',
    'The filepath to which the final proof mapping should be written'
  )
  .addOptionalParam(
    'silent',
    `Don't print excessive messages`,
    false,
    types.boolean
  )
  .setAction(async (args, hre) => {
    const {whitelistInput, proofOutput, silent} = args;

    // --------- Read the input file --------- //
    const addressesWithCaps: Array<WhitestItems> = JSON.parse(
      await readFile(whitelistInput, 'utf-8')
    ).addresses;
    const set = new Map();
    let allOk = true;
    for (const item of addressesWithCaps) {
      if (!hre.ethers.utils.isAddress(item.address)) {
        console.log(`${item.address} is not an address!`);
        allOk = false;
      }
      set.set(item.address, (set.get(item.address) ?? 0) + 1);
    }
    if (!allOk) return;

    if (addressesWithCaps.length !== set.size) {
      console.log(`Address list is not unique`);
      for (const item of set) {
        if (item[1] > 1) {
          console.log(`${item[0]} has ${item[1]} entries`);
        }
      }
      return;
    }

    // --------- sort the addresses --------- //
    addressesWithCaps.sort((a, b) => (a.address < b.address ? -1 : 1));

    // --------- Construct the Merkle tree --------- //
    const chainId = await hre.getChainId();
    const constructHash = (address: string, cap: number, partner: boolean) => {
      const hash = solidityKeccak256(
        ['address', 'uint256', 'uint256', 'bool'],
        [address, chainId, cap, partner]
      );
      return Buffer.from(hash.slice(2), 'hex');
    };

    const tree = new MerkleTree(
      addressesWithCaps.map((x) => constructHash(x.address, x.cap, x.partner))
    );

    // --------- Generate final json mapping --------- //
    const proofsPerToken: Array<{
      address: string;
      cap: number;
      partner: boolean;
      merkleProof: Array<string>;
    }> = await async.mapLimit(addressesWithCaps, 8, (value, cb) => {
      const hash = constructHash(value.address, value.cap, value.partner);
      const merkleProof = tree.getHexProof(hash);

      cb(null, {
        address: value.address,
        merkleProof,
        cap: value.cap,
        partner: value.partner,
      });
    });

    const resProofsObject: FinalWhitelistProofMapping = {};
    proofsPerToken.forEach((el) => {
      if (!silent) {
        console.log('Trace, constructing whitelist proof item', el.address);
      }
      const {address, merkleProof, cap, partner} = el;
      resProofsObject[address] = {cap, merkleProof, partner};
    });
    await promises.writeFile(proofOutput, JSON.stringify(resProofsObject));
    return tree.getHexRoot();
  });

export {};
