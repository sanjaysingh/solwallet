/** Legacy Solana transactions: system transfers and SPL TransferChecked. */

const LAMPORTS_PER_SOL = 1_000_000_000n;

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

export const SOL_COMPUTE_UNIT_LIMIT = 1_000;
export const SPL_COMPUTE_UNIT_LIMIT = 100_000;
export const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 1_000n;

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

function cryptoLib() {
    const lib = globalThis.SolanaCrypto;
    if (!lib?.sha256Hash || !lib?.isOnCurve || !lib?.sign) {
        throw new Error('Solana crypto library is not loaded.');
    }
    return lib;
}

function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function bytesEqual(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return false;
        }
    }
    return true;
}

export function encodeShortVec(length) {
    if (!Number.isInteger(length) || length < 0) {
        throw new Error('Invalid length');
    }
    const out = [];
    let value = length;
    while (true) {
        let elem = value & 0x7f;
        value >>= 7;
        if (value === 0) {
            out.push(elem);
            break;
        }
        out.push(elem | 0x80);
    }
    return Uint8Array.from(out);
}

function u32le(value) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, Number(value), true);
    return out;
}

function u64le(value) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
    return out;
}

export function decodePublicKey(text) {
    const trimmed = String(text ?? '').trim();
    let bytes;
    try {
        bytes = cryptoLib().decodeBase58(trimmed);
    } catch {
        throw new Error('Invalid address');
    }
    if (bytes.length !== 32) {
        throw new Error('Invalid address');
    }
    return bytes;
}

export function encodePublicKey(bytes) {
    return cryptoLib().encodeBase58(bytes);
}

export function findProgramAddress(seeds, programId) {
    const { sha256Hash, isOnCurve } = cryptoLib();
    for (let bump = 255; bump >= 0; bump--) {
        const hash = sha256Hash(concat([...seeds, Uint8Array.of(bump), programId, PDA_MARKER]));
        if (!isOnCurve(hash)) {
            return hash;
        }
    }
    throw new Error('Failed to find a program address');
}

export function associatedTokenAddress(owner, mint, tokenProgram = decodePublicKey(TOKEN_PROGRAM_ID)) {
    return findProgramAddress(
        [owner, tokenProgram, mint],
        decodePublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    );
}

const PUBKEY_COMPARE = {
    localeMatcher: 'best fit',
    usage: 'sort',
    sensitivity: 'variant',
    ignorePunctuation: false,
    numeric: false,
    caseFirst: 'lower',
};

function compileMessage({ feePayer, instructions, blockhash }) {
    const metas = [];
    const add = (pubkey, { signer = false, writable = false } = {}) => {
        const existing = metas.find((meta) => bytesEqual(meta.pubkey, pubkey));
        if (existing) {
            existing.signer = existing.signer || signer;
            existing.writable = existing.writable || writable;
            return;
        }
        metas.push({ pubkey, signer, writable });
    };

    add(feePayer, { signer: true, writable: true });
    for (const instruction of instructions) {
        add(instruction.programId, { signer: false, writable: false });
        for (const account of instruction.accounts) {
            add(account.pubkey, account);
        }
    }

    const comparePubkey = (left, right) => encodePublicKey(left.pubkey).localeCompare(
        encodePublicKey(right.pubkey),
        'en',
        PUBKEY_COMPARE,
    );
    const writableSigners = metas.filter((meta) => meta.signer && meta.writable).sort(comparePubkey);
    const payerIndex = writableSigners.findIndex((meta) => bytesEqual(meta.pubkey, feePayer));
    if (payerIndex > 0) {
        const [payer] = writableSigners.splice(payerIndex, 1);
        writableSigners.unshift(payer);
    }
    const ordered = [
        ...writableSigners,
        ...metas.filter((meta) => meta.signer && !meta.writable).sort(comparePubkey),
        ...metas.filter((meta) => !meta.signer && meta.writable).sort(comparePubkey),
        ...metas.filter((meta) => !meta.signer && !meta.writable).sort(comparePubkey),
    ];
    const indexOf = (pubkey) => ordered.findIndex((meta) => bytesEqual(meta.pubkey, pubkey));
    const numRequiredSignatures = ordered.filter((meta) => meta.signer).length;
    const numReadonlySignedAccounts = ordered.filter((meta) => meta.signer && !meta.writable).length;
    const numReadonlyUnsignedAccounts = ordered.filter((meta) => !meta.signer && !meta.writable).length;

    const parts = [
        Uint8Array.of(numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts),
        encodeShortVec(ordered.length),
        ...ordered.map((meta) => meta.pubkey),
        blockhash,
        encodeShortVec(instructions.length),
    ];
    for (const instruction of instructions) {
        const accountIndexes = instruction.accounts.map((account) => indexOf(account.pubkey));
        parts.push(
            Uint8Array.of(indexOf(instruction.programId)),
            encodeShortVec(accountIndexes.length),
            Uint8Array.from(accountIndexes),
            encodeShortVec(instruction.data.length),
            instruction.data,
        );
    }
    return concat(parts);
}

function signMessage(message, seed) {
    const signature = cryptoLib().sign(message, seed);
    if (signature.length !== 64) {
        throw new Error('Unexpected signature length');
    }
    return concat([encodeShortVec(1), signature, message]);
}

function computeBudgetInstructions(unitLimit, microLamports) {
    const programId = decodePublicKey(COMPUTE_BUDGET_PROGRAM_ID);
    return [
        {
            programId,
            accounts: [],
            data: concat([Uint8Array.of(2), u32le(unitLimit)]),
        },
        {
            programId,
            accounts: [],
            data: concat([Uint8Array.of(3), u64le(microLamports)]),
        },
    ];
}

export function buildAndSignSolTransfer({
    seed,
    to,
    lamports,
    blockhash,
    computeUnitLimit = SOL_COMPUTE_UNIT_LIMIT,
    microLamports = COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
}) {
    const from = cryptoLib().publicKeyFromSeed(seed);
    const toKey = to instanceof Uint8Array ? to : decodePublicKey(to);
    const recent = blockhash instanceof Uint8Array ? blockhash : decodePublicKey(blockhash);
    const instructions = [
        ...computeBudgetInstructions(computeUnitLimit, microLamports),
        {
            programId: decodePublicKey(SYSTEM_PROGRAM_ID),
            accounts: [
                { pubkey: from, signer: true, writable: true },
                { pubkey: toKey, signer: false, writable: true },
            ],
            data: concat([u32le(2), u64le(lamports)]),
        },
    ];
    const message = compileMessage({ feePayer: from, instructions, blockhash: recent });
    return {
        from,
        message,
        wire: signMessage(message, seed),
    };
}

export function buildAndSignSplTransfer({
    seed,
    mint,
    toOwner,
    rawAmount,
    decimals,
    blockhash,
    createDestinationAta,
    computeUnitLimit = SPL_COMPUTE_UNIT_LIMIT,
    microLamports = COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
}) {
    const owner = cryptoLib().publicKeyFromSeed(seed);
    const mintKey = mint instanceof Uint8Array ? mint : decodePublicKey(mint);
    const destinationOwner = toOwner instanceof Uint8Array ? toOwner : decodePublicKey(toOwner);
    const recent = blockhash instanceof Uint8Array ? blockhash : decodePublicKey(blockhash);
    const sourceAta = associatedTokenAddress(owner, mintKey);
    const destAta = associatedTokenAddress(destinationOwner, mintKey);
    const tokenProgram = decodePublicKey(TOKEN_PROGRAM_ID);
    const instructions = [...computeBudgetInstructions(computeUnitLimit, microLamports)];

    if (createDestinationAta) {
        instructions.push({
            programId: decodePublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
            accounts: [
                { pubkey: owner, signer: true, writable: true },
                { pubkey: destAta, signer: false, writable: true },
                { pubkey: destinationOwner, signer: false, writable: false },
                { pubkey: mintKey, signer: false, writable: false },
                { pubkey: decodePublicKey(SYSTEM_PROGRAM_ID), signer: false, writable: false },
                { pubkey: tokenProgram, signer: false, writable: false },
            ],
            data: Uint8Array.of(1),
        });
    }

    const data = new Uint8Array(10);
    data[0] = 12;
    data.set(u64le(rawAmount), 1);
    data[9] = Number(decimals);
    instructions.push({
        programId: tokenProgram,
        accounts: [
            { pubkey: sourceAta, signer: false, writable: true },
            { pubkey: mintKey, signer: false, writable: false },
            { pubkey: destAta, signer: false, writable: true },
            { pubkey: owner, signer: true, writable: false },
        ],
        data,
    });

    const message = compileMessage({ feePayer: owner, instructions, blockhash: recent });
    return {
        from: owner,
        sourceAta,
        destAta,
        message,
        wire: signMessage(message, seed),
    };
}

export function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

export function signatureBase58(wire) {
    const count = wire[0];
    if (count !== 1) {
        throw new Error('Expected one signature');
    }
    return cryptoLib().encodeBase58(wire.slice(1, 65));
}

export function assertSolTransferAffordable({ balance, lamports, fee, rentExemptMinimum }) {
    const amount = BigInt(lamports);
    const feeLamports = BigInt(fee);
    const rent = BigInt(rentExemptMinimum);
    const funds = BigInt(balance);
    if (amount <= 0n) {
        throw new Error('Amount must be greater than zero');
    }
    if (amount + feeLamports > funds) {
        throw new Error('Insufficient SOL for the amount and network fee');
    }
    const remaining = funds - amount - feeLamports;
    if (remaining > 0n && remaining < rent) {
        throw new Error(
            `This would leave the account below the rent-exempt minimum (${lamportsToSol(rent)} SOL). Send less, or the full balance minus the fee.`,
        );
    }
}

export function assertFeeLeavesRent({ balance, fee, rentExemptMinimum }) {
    const feeLamports = BigInt(fee);
    const rent = BigInt(rentExemptMinimum);
    const funds = BigInt(balance);
    if (feeLamports > funds) {
        throw new Error('Insufficient SOL for the network fee');
    }
    if (funds - feeLamports < rent) {
        throw new Error(
            `Not enough SOL left for rent after the fee (minimum ${lamportsToSol(rent)} SOL).`,
        );
    }
}

function lamportsToSol(lamports) {
    const abs = BigInt(lamports);
    const whole = abs / LAMPORTS_PER_SOL;
    const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
}
