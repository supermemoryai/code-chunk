import { findScopeAtOffset, getAncestorChain } from '../scope/tree'
import type {
	ByteRange,
	ChunkContext,
	ChunkEntityInfo,
	EntityInfo,
	ExtractedEntity,
	ImportInfo,
	ScopeTree,
} from '../types'

/**
 * Get scope information for a byte range
 *
 * Finds the scope containing this range and builds an array of EntityInfo
 * from the scope and its ancestors.
 *
 * @param byteRange - The byte range to get scope for
 * @param scopeTree - The scope tree
 * @returns Scope entity info array representing the scope chain
 */
export const getScopeForRange = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
): ChunkContext['scope'] => {
	// Find the scope at the start of the range
	const scope = findScopeAtOffset(scopeTree, byteRange.start)

	if (!scope) {
		return []
	}

	// Build scope chain: current scope + ancestors
	const scopeChain: EntityInfo[] = []

	// Add current scope
	scopeChain.push({
		name: scope.entity.name,
		type: scope.entity.type,
		signature: scope.entity.signature,
	})

	// Add ancestors (from immediate parent to root)
	const ancestors = getAncestorChain(scope)
	for (const ancestor of ancestors) {
		scopeChain.push({
			name: ancestor.entity.name,
			type: ancestor.entity.type,
			signature: ancestor.entity.signature,
		})
	}

	return scopeChain
}

/**
 * Check if an entity is partial (not fully contained) within a byte range
 *
 * An entity is partial if it overlaps with the range but is not fully contained.
 *
 * @param entity - The entity to check
 * @param byteRange - The chunk's byte range
 * @returns Whether the entity is partial
 */
const isEntityPartial = (
	entity: ExtractedEntity,
	byteRange: ByteRange,
): boolean => {
	// Entity is partial if it starts before the range or ends after the range
	return (
		entity.byteRange.start < byteRange.start ||
		entity.byteRange.end > byteRange.end
	)
}

/**
 * Get entities within a byte range
 *
 * Finds entities whose byte ranges overlap with the given range.
 * Overlap condition: entity.start < range.end && entity.end > range.start
 *
 * @param byteRange - The byte range to search
 * @param scopeTree - The scope tree
 * @returns Entity info array for entities in range with isPartial detection
 */
export const getEntitiesInRange = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
): ChunkContext['entities'] => {
	const overlappingEntities = scopeTree.allEntities.filter((entity) => {
		// Overlap check: entity.start < range.end && entity.end > range.start
		return (
			entity.byteRange.start < byteRange.end &&
			entity.byteRange.end > byteRange.start
		)
	})

	// Map to ChunkEntityInfo with additional fields
	return overlappingEntities.map(
		(entity): ChunkEntityInfo => ({
			name: entity.name,
			type: entity.type,
			signature: entity.signature,
			docstring: entity.docstring,
			lineRange: entity.lineRange,
			isPartial: isEntityPartial(entity, byteRange),
		}),
	)
}

/**
 * Get import source from an import entity
 *
 * Uses the pre-extracted source from AST parsing (works for all languages).
 *
 * @param entity - The import entity
 * @returns The import source or empty string if not found
 */
const getImportSource = (entity: ExtractedEntity): string => {
	return entity.source ?? ''
}

/**
 * Get relevant imports for a chunk
 *
 * @param entities - Entities in the chunk
 * @param scopeTree - The scope tree
 * @param filterImports - Whether to filter to only used imports
 * @returns Import info array
 */
export const getRelevantImports = (
	entities: ChunkContext['entities'],
	scopeTree: ScopeTree,
	filterImports: boolean,
): ChunkContext['imports'] => {
	const imports = scopeTree.imports

	if (imports.length === 0) {
		return []
	}

	// Map import entity to ImportInfo
	const mapToImportInfo = (entity: ExtractedEntity): ImportInfo => ({
		name: entity.name,
		source: getImportSource(entity),
	})

	// If not filtering, return all imports
	if (!filterImports) {
		return imports.map(mapToImportInfo)
	}

	// Filter to only imports that are used by entities in the chunk
	// Build a set of names that appear in entity signatures and names
	const usedNames = new Set<string>()
	for (const entity of entities) {
		// Add the entity name
		usedNames.add(entity.name)

		// Extract identifiers from signature if available
		if (entity.signature) {
			// Match word characters that could be identifiers
			const identifiers = entity.signature.match(
				/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g,
			)
			if (identifiers) {
				for (const id of identifiers) {
					usedNames.add(id)
				}
			}
		}
	}

	// Filter imports to those whose names appear in the chunk
	const filteredImports = imports.filter((importEntity) => {
		return usedNames.has(importEntity.name)
	})

	return filteredImports.map(mapToImportInfo)
}
