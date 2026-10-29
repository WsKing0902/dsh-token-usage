import { randomUUID } from 'node:crypto';
import { modelKey } from "./model-resolution.js";
import { readPricingContext, readPricingContextLocked } from "./pricing.js";
import { AssociationError, associationWritesPaused, exactFields, isAssociationName, pricingDirectoryKey, withPricingDirectoryWrite, writeAssociations } from "./pricing-associations.js";
import { consoleLogger } from "./log.js";
/** Directory epochs reject forms from an earlier directory, including a
 * round-trip back to the same path after migration. */
export class PricingAssociationService {
    directory;
    logger;
    directoryKey = '';
    directoryToken = randomUUID();
    constructor(directory, logger = consoleLogger) {
        this.directory = directory;
        this.logger = logger;
    }
    directoryChanged() {
        this.directoryKey = pricingDirectoryKey(this.directory());
        this.directoryToken = randomUUID();
    }
    capture() {
        const dir = this.directory();
        if (pricingDirectoryKey(dir) !== this.directoryKey)
            this.directoryChanged();
        return { dir, token: this.directoryToken };
    }
    verify(token) {
        if (this.capture().token !== token)
            throw new AssociationError('directory-conflict');
    }
    payload(context, token, sourceModel) {
        return {
            ...(context.feedVersion !== undefined ? { feedVersion: context.feedVersion } : {}),
            directoryToken: token,
            revision: context.associations.state === 'ready' ? context.associations.file.revision : null,
            storageState: context.associations.state,
            ...(context.associations.state === 'unavailable' ? { storageError: context.associations.error } : {}),
            pricingAvailable: context.available,
            ...(context.unavailableReason !== undefined ? { pricingUnavailableReason: context.unavailableReason } : {}),
            writesPaused: associationWritesPaused(this.directory()),
            associations: [...context.associationStatuses].sort((a, b) => modelKey(a.sourceModel).localeCompare(modelKey(b.sourceModel))),
            ...(sourceModel !== undefined ? { resolution: context.resolveModel(sourceModel) } : {}),
        };
    }
    async read(sourceModel) {
        if (sourceModel !== undefined && !isAssociationName(sourceModel))
            throw new AssociationError('invalid-source', 400);
        const snapshot = this.capture();
        const context = await readPricingContext(snapshot.dir, this.logger);
        this.verify(snapshot.token);
        return this.payload(context, snapshot.token, sourceModel);
    }
    /** Validate the entire request; clients cannot submit paths, prices or
     * whole files. Idempotency is checked only after the revision guard. */
    async mutate(operation, value) {
        const fields = operation === 'save' ? ['sourceModel', 'targetModelId', 'revision', 'directoryToken'] : ['sourceModel', 'revision', 'directoryToken'];
        if (!exactFields(value, fields) || !isAssociationName(value.sourceModel)
            || (operation === 'save' && !isAssociationName(value.targetModelId))
            || typeof value.directoryToken !== 'string' || value.directoryToken === ''
            || !Number.isSafeInteger(value.revision) || value.revision < 0)
            throw new AssociationError('invalid-body', 400);
        const input = value;
        const snapshot = this.capture();
        this.verify(input.directoryToken);
        return withPricingDirectoryWrite(snapshot.dir, async () => {
            this.verify(input.directoryToken);
            const context = await readPricingContextLocked(snapshot.dir, this.logger);
            this.verify(input.directoryToken);
            const stored = context.associations;
            if (stored.state !== 'ready')
                throw new AssociationError('association-storage-unavailable', 503);
            if (stored.file.revision !== input.revision)
                throw new AssociationError('revision-conflict');
            const key = modelKey(input.sourceModel);
            const current = stored.file.associations.find(row => modelKey(row.sourceModel) === key);
            let target;
            if (operation === 'save') {
                if (!context.available)
                    throw new AssociationError('pricing-unavailable');
                if (context.resolveAutomatic(input.sourceModel).status === 'matched')
                    throw new AssociationError('source-automatically-priced');
                const requested = input.targetModelId;
                target = context.models.find(model => modelKey(model.modelId) === modelKey(requested))?.modelId;
                if (target === undefined)
                    throw new AssociationError('target-unavailable');
            }
            if ((operation === 'delete' && current === undefined)
                || (target !== undefined && current !== undefined && modelKey(current.targetModelId) === modelKey(target))) {
                return this.payload(context, snapshot.token, input.sourceModel);
            }
            if (stored.file.revision === Number.MAX_SAFE_INTEGER)
                throw new AssociationError('revision-exhausted');
            const associations = stored.file.associations.filter(row => modelKey(row.sourceModel) !== key);
            if (target !== undefined)
                associations.push({ sourceModel: current?.sourceModel ?? input.sourceModel, targetModelId: target });
            associations.sort((a, b) => modelKey(a.sourceModel).localeCompare(modelKey(b.sourceModel)));
            await writeAssociations(snapshot.dir, stored, { version: 1, revision: stored.file.revision + 1, associations }, () => this.verify(input.directoryToken));
            const updated = await readPricingContextLocked(snapshot.dir, this.logger);
            this.verify(input.directoryToken);
            return this.payload(updated, snapshot.token, input.sourceModel);
        });
    }
}
//# sourceMappingURL=pricing-association-service.js.map