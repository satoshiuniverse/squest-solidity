import {promises} from 'fs';
import {MerkleTree} from '../MerkleTree/merkle-tree';
import async from 'async';

export interface FinalProofMapping {
  // Token id : ...
  [key: string]: {ipfsUri: string; merkleProof: Array<string>; dna: number};
}

interface GeneratedCards {
  // Token id : ...
  [key: string]: {ipfsUri: string; dna: number; hash: string};
}
export async function generateMerkleTree(
  dirInput: string,
  dirOutput: string
): Promise<{
  tree: MerkleTree;
  resProofsObject: FinalProofMapping;
}> {
  const fileRes = await promises.readFile(dirInput, 'utf-8');
  const genCards: GeneratedCards = JSON.parse(fileRes);
  const genCardsHashes = Object.entries(genCards).map(([, val]) =>
    Buffer.from(val.hash.slice(2), 'hex')
  );
  // Merklize cards
  const tree = new MerkleTree(genCardsHashes);

  // Generate final json mapping
  const proofsPerToken: Array<{
    tokenId: string;
    merkleProof: Array<string>;
    ipfsUri: string;
    dna: number;
  }> = await async.mapLimit(Object.entries(genCards), 8, ([key, value], cb) => {
    const merkleProof = tree.getHexProof(
      Buffer.from(value.hash.slice(2), 'hex')
    );
    const ipfsUri = value.ipfsUri;

    cb(null, {
      tokenId: key,
      merkleProof,
      ipfsUri,
      dna: value.dna,
    });
  });

  const resProofsObject: FinalProofMapping = {};
  proofsPerToken.forEach((el) => {
    console.log('Trace, constructing proofpertoken', el.tokenId);
    const {ipfsUri, merkleProof, dna, tokenId} = el;
    resProofsObject[tokenId] = {ipfsUri, merkleProof, dna};
  });
  await promises.writeFile(dirOutput, JSON.stringify(resProofsObject));
  return {tree, resProofsObject};
}
