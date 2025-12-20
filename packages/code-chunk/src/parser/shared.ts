import type { Node as TSNode, Tree as TSTree } from 'web-tree-sitter'
import type { ParseResult } from '../types'

export function hasParseErrors(tree: TSTree): boolean {
	return tree.rootNode.hasError
}

export function getParseErrorMessage(tree: TSTree): string {
	const errorNodes: string[] = []

	function findErrors(node: TSNode) {
		if (node.isError || node.isMissing) {
			const pos = node.startPosition
			errorNodes.push(
				`${node.isError ? 'ERROR' : 'MISSING'} at line ${pos.row + 1}, column ${pos.column + 1}`,
			)
		}
		for (const child of node.children) {
			findErrors(child)
		}
	}

	findErrors(tree.rootNode)
	return errorNodes.length > 0
		? errorNodes.slice(0, 3).join('; ') +
				(errorNodes.length > 3 ? `; ... and ${errorNodes.length - 3} more` : '')
		: 'Unknown parse error'
}

export function buildParseResult(tree: TSTree | null): ParseResult {
	if (!tree) {
		return {
			tree: undefined as unknown as TSTree,
			error: {
				message: 'Parser returned null - no language set or parsing cancelled',
				recoverable: false,
			},
		}
	}

	if (hasParseErrors(tree)) {
		return {
			tree,
			error: {
				message: getParseErrorMessage(tree),
				recoverable: true,
			},
		}
	}

	return { tree, error: null }
}
