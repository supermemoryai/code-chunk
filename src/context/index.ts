import { Effect } from 'effect'
import type { RebuiltText } from '../chunking/rebuild'
import type {
	ByteRange,
	Chunk,
	ChunkContext,
	ChunkOptions,
	ScopeTree,
} from '../types'

/**
 * Error when attaching context fails
 */
export class ContextError {
	readonly _tag = 'ContextError'
	constructor(
		readonly message: string,
		readonly cause?: unknown,
	) {}
}

/**
 * Attach context information to a chunk
 *
 * @param text - The rebuilt text info for the chunk
 * @param scopeTree - The scope tree for the file
 * @param options - Chunking options
 * @param index - The chunk index
 * @param totalChunks - Total number of chunks
 * @returns Effect yielding the complete chunk with context
 *
 * TODO: Implement context attachment
 */
export const attachContext = (
	text: RebuiltText,
	scopeTree: ScopeTree,
	options: ChunkOptions,
	index: number,
	totalChunks: number,
): Effect.Effect<Chunk, ContextError> => {
	// TODO: Implement context attachment
	// 1. Find scope for this chunk's byte range
	// 2. Get entities within the chunk
	// 3. Get siblings based on options
	// 4. Get relevant imports
	const context: ChunkContext = {
		scope: [],
		entities: [],
		siblings: [],
		imports: [],
	}

	void scopeTree
	void options

	return Effect.succeed({
		text: text.text,
		byteRange: text.byteRange,
		lineRange: text.lineRange,
		context,
		index,
		totalChunks,
	})
}

/**
 * Get scope information for a byte range
 *
 * @param byteRange - The byte range to get scope for
 * @param scopeTree - The scope tree
 * @returns Scope entity info array
 *
 * TODO: Implement scope lookup
 */
export const getScopeForRange = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
): ChunkContext['scope'] => {
	// TODO: Implement scope lookup
	// Find containing scopes and return as EntityInfo[]
	void byteRange
	void scopeTree
	return []
}

/**
 * Get entities within a byte range
 *
 * @param byteRange - The byte range to search
 * @param scopeTree - The scope tree
 * @returns Entity info array for entities in range
 *
 * TODO: Implement entity lookup
 */
export const getEntitiesInRange = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
): ChunkContext['entities'] => {
	// TODO: Implement entity lookup
	// Find entities whose ranges overlap with byteRange
	void byteRange
	void scopeTree
	return []
}

/**
 * Get relevant imports for a chunk
 *
 * @param entities - Entities in the chunk
 * @param scopeTree - The scope tree
 * @param filterImports - Whether to filter to only used imports
 * @returns Import info array
 *
 * TODO: Implement import filtering
 */
export const getRelevantImports = (
	entities: ChunkContext['entities'],
	scopeTree: ScopeTree,
	filterImports: boolean,
): ChunkContext['imports'] => {
	// TODO: Implement import filtering
	// If filterImports, only include imports used by chunk entities
	void entities
	void scopeTree
	void filterImports
	return []
}
