import type { ASTWindow } from '../types'

/**
 * Options for merging adjacent windows
 */
export interface MergeOptions {
	/** Maximum size of a merged window */
	maxSize: number
}

/**
 * Merge adjacent windows that together fit within maxSize
 *
 * @param windows - Generator of windows to merge
 * @param options - Merge options
 * @yields Merged ASTWindow objects
 *
 * TODO: Implement window merging
 */
export function* mergeAdjacentWindows(
	_windows: Generator<ASTWindow> | Iterable<ASTWindow>,
	_options: MergeOptions,
): Generator<ASTWindow> {
	// TODO: Implement adjacent window merging
	// 1. Accumulate windows while they fit
	// 2. When adding would exceed maxSize, yield accumulated and start fresh
	// 3. Merge nodes and ancestors from accumulated windows
	yield* []
}

/**
 * Merge two windows into one
 *
 * @param a - First window
 * @param b - Second window
 * @returns Merged window
 */
export const mergeWindows = (a: ASTWindow, b: ASTWindow): ASTWindow => {
	// Combine nodes from both windows
	const nodes = [...a.nodes, ...b.nodes]

	// Combine ancestors, deduplicating by node ID
	const ancestorIds = new Set<number>()
	const ancestors = []
	for (const ancestor of [...a.ancestors, ...b.ancestors]) {
		if (!ancestorIds.has(ancestor.id)) {
			ancestorIds.add(ancestor.id)
			ancestors.push(ancestor)
		}
	}

	// Combine line ranges if present
	const lineRanges =
		a.lineRanges && b.lineRanges
			? [...a.lineRanges, ...b.lineRanges]
			: undefined

	return {
		nodes,
		ancestors,
		size: a.size + b.size,
		isPartialNode: a.isPartialNode || b.isPartialNode,
		lineRanges,
	}
}

/**
 * Check if two windows can be merged
 *
 * @param a - First window
 * @param b - Second window
 * @param maxSize - Maximum combined size
 * @returns Whether the windows can be merged
 */
export const canMerge = (
	a: ASTWindow,
	b: ASTWindow,
	maxSize: number,
): boolean => {
	return a.size + b.size <= maxSize
}
