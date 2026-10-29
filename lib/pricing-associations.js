/** Durable name references; prices and usage records never live in this file. */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { modelKey } from "./model-resolution.js";
export const ASSOCIATIONS_FILE = 'pricing-associations.json';
const TMP_FILE = `${ASSOCIATIONS_FILE}.tmp`;
export class AssociationError extends Error {
    code;
    statusCode;
    constructor(code, statusCode = 409) {
        super(code);
        this.code = code;
        this.statusCode = statusCode;
    }
}
/** Compare complete names without trimming or dropping namespace components. */
export function isAssociationName(value) {
    return typeof value === 'string' && value !== '' && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
}
export function exactFields(value, fields) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        && Object.keys(value).length === fields.length
        && fields.every(field => Object.hasOwn(value, field));
}
export function coerceAssociations(value) {
    if (!exactFields(value, ['version', 'revision', 'associations']) || value.version !== 1
        || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.associations))
        return null;
    const keys = new Set();
    const associations = [];
    for (const row of value.associations) {
        if (!exactFields(row, ['sourceModel', 'targetModelId'])
            || !isAssociationName(row.sourceModel) || !isAssociationName(row.targetModelId))
            return null;
        const key = modelKey(row.sourceModel);
        if (keys.has(key))
            return null;
        keys.add(key);
        associations.push({ sourceModel: row.sourceModel, targetModelId: row.targetModelId });
    }
    return { version: 1, revision: value.revision, associations };
}
/** Missing is empty; malformed or unreadable durable choices are never erased. */
export async function readAssociations(dir) {
    let source;
    try {
        source = await readFile(join(dir, ASSOCIATIONS_FILE), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { state: 'ready', source: null, file: { version: 1, revision: 0, associations: [] } };
        }
        return { state: 'unavailable', source: null, error: 'unreadable' };
    }
    let value;
    try {
        value = JSON.parse(source);
    }
    catch {
        return { state: 'unavailable', source, error: 'invalid-json' };
    }
    const file = coerceAssociations(value);
    return file === null ? { state: 'unavailable', source, error: 'invalid-file' } : { state: 'ready', source, file };
}
const queues = new Map();
export function pricingDirectoryKey(dir) {
    const absolute = resolve(dir);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
function queueOf(dir) {
    const key = pricingDirectoryKey(dir);
    let state = queues.get(key);
    if (state === undefined) {
        state = { tail: Promise.resolve(), paused: false, epoch: 0 };
        queues.set(key, state);
    }
    return state;
}
/** Snapshot reads and feed/association commits share one process-local queue. */
export function withPricingDirectoryRead(dir, run) {
    const state = queueOf(dir);
    const task = state.tail.catch(() => undefined).then(run);
    state.tail = task.catch(() => undefined);
    return task;
}
export function withPricingDirectoryWrite(dir, run) {
    if (queueOf(dir).paused)
        return Promise.reject(new AssociationError('migration-in-progress'));
    return withPricingDirectoryRead(dir, run);
}
export function associationWritesPaused(dir) { return queueOf(dir).paused; }
export function pricingDirectoryEpoch(dir) { return queueOf(dir).epoch; }
/** Block new commits to both directories, drain already accepted writes,
 * and keep them paused through copying, switching and source cleanup. */
export async function withPricingDirectoryMigration(oldDir, newDir, run) {
    const states = [...new Set([queueOf(oldDir), queueOf(newDir)])];
    if (states.some(state => state.paused))
        throw new AssociationError('migration-in-progress');
    for (const state of states) {
        state.paused = true;
        state.epoch += 1;
    }
    try {
        await Promise.all(states.map(state => state.tail));
        return await run();
    }
    finally {
        for (const state of states)
            state.paused = false;
    }
}
/** Caller holds the directory queue. Verify both the directory epoch and
 * original bytes immediately before replacing durable user choices. */
export async function writeAssociations(dir, expected, file, verifyDirectory) {
    const path = join(dir, ASSOCIATIONS_FILE), tmp = join(dir, TMP_FILE);
    await mkdir(dir, { recursive: true });
    try {
        await writeFile(tmp, JSON.stringify(file) + '\n', 'utf8');
        const source = await readFile(path, 'utf8').catch((error) => {
            if (error.code === 'ENOENT')
                return null;
            throw error;
        });
        verifyDirectory();
        if (source !== expected.source)
            throw new AssociationError('revision-conflict');
        await rename(tmp, path);
    }
    finally {
        await unlink(tmp).catch(() => undefined);
    }
}
//# sourceMappingURL=pricing-associations.js.map