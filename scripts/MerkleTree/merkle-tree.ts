/* prettier-ignore */

import {keccak256, bufferToHex} from 'ethereumjs-util';

export class MerkleTree {
  elements: Array<Buffer>;
  layers: Array<Array<Buffer>>;

  constructor(elements: Array<Buffer>) {
    // Filter empty strings and hash elements
    this.elements = elements.filter((el) => el);

    // Sort elements
    this.elements.sort(Buffer.compare);
    // Deduplicate elements
    this.elements = this.bufDedup(this.elements);

    // Create layers
    this.layers = this.getLayers(this.elements);
  }

  getLayers(elements: Array<Buffer>): Array<Array<Buffer>> {
    if (elements.length === 0) {
      return [[Buffer.from([])]];
    }

    const layers = [];
    layers.push(elements);

    // Get next layer until we reach the root
    while (layers[layers.length - 1].length > 1) {
      layers.push(this.getNextLayer(layers[layers.length - 1]));
    }

    return layers;
  }

  getNextLayer(elements: Array<Buffer>): Array<Buffer> {
    return elements.reduce((layer: Array<Buffer>, el, idx, arr) => {
      if (idx % 2 === 0) {
        // Hash the current element with its pair element
        const nextEl = arr[idx + 1];
        const res = this.combinedHash(el, nextEl);
        layer.push(res);
      }

      return layer;
    }, []);
  }

  combinedHash(first: Buffer, second: Buffer): Buffer {
    if (!first) {
      return second;
    }
    if (!second) {
      return first;
    }

    return keccak256(this.sortAndConcat(first, second));
  }

  getRoot(): Buffer {
    const root = this.layers[this.layers.length - 1][0];
    if (root.length === 0) {
      // Return an empty buffer of 32 bytes otherwise
      return Buffer.alloc(32, 0);
    }
    return root;
  }

  getHexRoot(): string {
    return bufferToHex(this.getRoot());
  }

  getProof(el: Buffer): Array<Buffer> {
    let idx = this.bufIndexOf(el, this.elements);

    if (idx === -1) {
      throw new Error('Element does not exist in Merkle tree');
    }

    return this.layers.reduce((proof, layer) => {
      const pairElement = this.getPairElement(idx, layer);

      if (pairElement) {
        proof.push(pairElement);
      }

      idx = Math.floor(idx / 2);

      return proof;
    }, []);
  }

  getHexProof(el: Buffer): string[] {
    const proof = this.getProof(el);

    return this.bufArrToHexArr(proof);
  }

  getPairElement(idx: number, layer: Array<Buffer>): Buffer | null {
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;

    if (pairIdx < layer.length) {
      return layer[pairIdx];
    } else {
      return null;
    }
  }

  bufIndexOf(el: Buffer, arr: Array<Buffer>): number {
    for (let i = 0; i < arr.length; i++) {
      if (el.equals(arr[i])) {
        return i;
      }
    }

    return -1;
  }

  bufDedup(elements: Array<Buffer>): Array<Buffer> {
    return elements.filter((el, idx) => {
      return idx === 0 || !elements[idx - 1].equals(el);
    });
  }

  bufArrToHexArr(arr: Array<Buffer>): string[] {
    if (arr.some((el) => !Buffer.isBuffer(el))) {
      throw new Error('Array is not an array of buffers');
    }

    return arr.map((el) => '0x' + el.toString('hex'));
  }

  sortAndConcat(...args: Array<Buffer>): Buffer {
    return Buffer.concat([...args].sort(Buffer.compare));
  }
}
