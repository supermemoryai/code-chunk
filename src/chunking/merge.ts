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
 */
export function* mergeAdjacentWindows(
	windows: Generator<ASTWindow> | Iterable<ASTWindow>,
	options: MergeOptions,
): Generator<ASTWindow> {
	const { maxSize } = options
	let current: ASTWindow | null = null

	for (const window of windows) {
		if (!current) {
			current = window
		} else if (canMerge(current, window, maxSize)) {
			current = mergeWindows(current, window)
		} else {
			yield current
			current = window
		}
	}

	if (current) {
		yield current
	}
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
